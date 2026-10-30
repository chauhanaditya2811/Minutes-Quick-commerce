import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../config/database.js";
import { getCashfreeWebhookSecret } from "../config/cashfree.js";
import { notifyOwner, notifyStockShortfall } from "./telegram.service.js";
import { CheckoutError, finalizePaidOrder, recordFailedPaymentAttempt } from "./order.service.js";

export class CashfreeWebhookError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "CashfreeWebhookError";
  }
}

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const verifySignature = (rawBody: Buffer, signature?: string, timestamp?: string) => {
  if (!signature || !timestamp || !/^\d+$/.test(timestamp)) {
    throw new CashfreeWebhookError("Missing Cashfree webhook signature.", 400);
  }
  const expected = createHmac("sha256", getCashfreeWebhookSecret())
    .update(timestamp + rawBody.toString("utf8"))
    .digest("base64");
  const received = Buffer.from(signature, "base64");
  const expectedBytes = Buffer.from(expected, "base64");
  if (received.length !== expectedBytes.length || !timingSafeEqual(received, expectedBytes)) {
    throw new CashfreeWebhookError("Cashfree webhook signature verification failed.", 400);
  }
};

const eventId = (payload: RecordValue, header?: string) => {
  if (header?.trim()) return header.trim();
  const data = isRecord(payload.data) ? payload.data : undefined;
  const payment = data && isRecord(data.payment) ? data.payment : undefined;
  const id = payment?.cf_payment_id;
  if (typeof id !== "string" || !id) {
    throw new CashfreeWebhookError("The Cashfree webhook event ID is required.", 400);
  }
  return id;
};

export const processCashfreeWebhook = async (
  rawBody: Buffer,
  signature: string | undefined,
  timestamp: string | undefined,
  suppliedEventId?: string,
) => {
  verifySignature(rawBody, signature, timestamp);
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new CashfreeWebhookError("The webhook body is not valid JSON.", 400);
  }
  if (!isRecord(payload) || typeof payload.type !== "string" || !isRecord(payload.data)) {
    throw new CashfreeWebhookError("Invalid Cashfree webhook event.", 400);
  }
  const id = eventId(payload, suppliedEventId);
  const data = payload.data;
  const order = isRecord(data.order) ? data.order : undefined;
  const payment = isRecord(data.payment) ? data.payment : undefined;
  const orderId = order?.order_id;
  const orderAmount = order?.order_amount;
  const orderCurrency = order?.order_currency;
  const paymentId = payment?.cf_payment_id;
  const amount = payment?.payment_amount;
  const currency = payment?.payment_currency;
  const status = payment?.payment_status;
  if (
    typeof orderId !== "string" ||
    typeof paymentId !== "string" ||
    typeof amount !== "number" ||
    typeof currency !== "string" ||
    typeof status !== "string" ||
    typeof orderAmount !== "number" ||
    typeof orderCurrency !== "string"
  ) {
    throw new CashfreeWebhookError("Cashfree webhook payment details are invalid.", 400);
  }
  const isSuccessEvent = payload.type === "PAYMENT_SUCCESS_WEBHOOK";
  const isFailureEvent = payload.type === "PAYMENT_FAILED_WEBHOOK";
  if (!isSuccessEvent && !isFailureEvent) {
    return prisma.cashfreeWebhookEvent.create({
      data: { eventId: id, eventType: payload.type },
    }).then(() => ({
      received: true,
      processed: false,
      event: payload.type,
      reason: "unsupported_event",
    })).catch((error: unknown) => {
      if (isRecord(error) && error.code === "P2002") {
        return { received: true, processed: false, reason: "duplicate_event" };
      }
      throw error;
    });
  }
  if (
    orderCurrency !== "INR" ||
    currency !== "INR" ||
    orderAmount !== amount ||
    status !== (isSuccessEvent ? "SUCCESS" : "FAILED")
  ) {
    throw new CashfreeWebhookError("The Cashfree webhook payment does not match the order.", 409);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.cashfreeWebhookEvent.findUnique({ where: { eventId: id } });
      if (duplicate) return { received: true, processed: false, reason: "duplicate_event" };
      await tx.cashfreeWebhookEvent.create({ data: { eventId: id, eventType: payload.type as string } });

      const attempt = await tx.paymentAttempt.findFirst({
        where: { cashfreeOrderId: orderId, provider: "CASHFREE" },
        include: { order: true },
      });
      if (!attempt?.order) throw new CashfreeWebhookError("No matching payment attempt was found.", 503);
      if (attempt.amount !== amount || attempt.order.total !== amount) {
        throw new CashfreeWebhookError("The webhook payment does not match the stored order amount.", 409);
      }
      if (isFailureEvent) {
        await recordFailedPaymentAttempt(tx, {
          orderId: attempt.order.id,
          attemptId: attempt.id,
          cashfreePaymentId: paymentId,
        });
        return { received: true, processed: true, event: payload.type, paymentStatus: "FAILED" };
      }
      let finalized;
      try {
        finalized = await finalizePaidOrder(tx, {
          orderId: attempt.order.id,
          attemptId: attempt.id,
          cashfreeOrderId: orderId,
          cashfreePaymentId: paymentId,
          amount: attempt.amount,
        });
      } catch (error) {
        if (error instanceof CheckoutError) {
          throw new CashfreeWebhookError("The order is not eligible for payment confirmation.", 409);
        }
        throw error;
      }
      if (!finalized.newlyConfirmed) {
        return { received: true, processed: false, reason: "already_processed" };
      }
      return {
        received: true,
        processed: true,
        event: payload.type,
        orderId: attempt.order.id,
        paymentStatus: "SUCCESS" as const,
        orderStatus: "CONFIRMED" as const,
        newlyConfirmed: true,
        shortfall: finalized.shortfall,
      };
    });
    if (result.newlyConfirmed) {
      void notifyOwner(result.orderId).catch((error: unknown) => {
        console.error("Cashfree webhook Telegram notification failed:", error);
      });
      if (result.shortfall) void notifyStockShortfall(result.orderId);
    }
    const { newlyConfirmed: _newlyConfirmed, shortfall: _shortfall, ...publicResult } = result;
    return publicResult;
  } catch (error) {
    if (isRecord(error) && error.code === "P2002") {
      return { received: true, processed: false, reason: "duplicate_event" };
    }
    throw error;
  }
};
