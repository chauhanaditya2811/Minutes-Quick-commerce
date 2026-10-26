import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../config/database.js";
import { getCashfreeWebhookSecret } from "../config/cashfree.js";
import { notifyOwner } from "./telegram.service.js";

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
        await tx.paymentAttempt.update({
          where: { id: attempt.id },
          data: { status: "FAILED", cashfreePaymentId: paymentId, provider: "CASHFREE" },
        });
        if (attempt.order.paymentStatus !== "SUCCESS") {
          await tx.order.update({ where: { id: attempt.order.id }, data: { paymentStatus: "FAILED" } });
        }
        return { received: true, processed: true, event: payload.type, paymentStatus: "FAILED" };
      }
      if (
        attempt.order.paymentStatus === "SUCCESS" &&
        ["CONFIRMED", "DELIVERED"].includes(attempt.order.orderStatus)
      ) {
        return { received: true, processed: false, reason: "already_processed" };
      }
      if (attempt.order.orderStatus !== "PENDING_PAYMENT") {
        throw new CashfreeWebhookError(
          "The order is not eligible for payment confirmation.",
          409,
        );
      }
      await tx.order.update({ where: { id: attempt.order.id }, data: { paymentStatus: "SUCCESS", orderStatus: "CONFIRMED" } });
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: { status: "SUCCESS", cashfreePaymentId: paymentId, provider: "CASHFREE" },
      });
      await tx.payment.upsert({
        where: { orderId: attempt.order.id },
        create: {
          orderId: attempt.order.id,
          cashfreeOrderId: orderId,
          cashfreePaymentId: paymentId,
          amount: attempt.amount,
          status: "SUCCESS",
          provider: "CASHFREE",
        },
        update: {
          cashfreeOrderId: orderId,
          cashfreePaymentId: paymentId,
          amount: attempt.amount,
          status: "SUCCESS",
          provider: "CASHFREE",
        },
      });
      return {
        received: true,
        processed: true,
        event: payload.type,
        orderId: attempt.order.id,
        paymentStatus: "SUCCESS" as const,
        orderStatus: "CONFIRMED" as const,
        newlyConfirmed: true,
      };
    });
    if (result.newlyConfirmed) {
      void notifyOwner(result.orderId, "Cashfree").catch((error: unknown) => {
        console.error("Cashfree webhook Telegram notification failed:", error);
      });
    }
    const { newlyConfirmed: _newlyConfirmed, ...publicResult } = result;
    return publicResult;
  } catch (error) {
    if (isRecord(error) && error.code === "P2002") {
      return { received: true, processed: false, reason: "duplicate_event" };
    }
    throw error;
  }
};
