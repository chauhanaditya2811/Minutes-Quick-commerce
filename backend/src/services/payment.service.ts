import { createHash } from "node:crypto";
import { prisma } from "../config/database.js";
import {
  CASHFREE_API_VERSION,
  getCashfreeApiBaseUrl,
  getCashfreeClientId,
  getCashfreeClientSecret,
} from "../config/cashfree.js";
import { notifyOwner } from "./telegram.service.js";
import { CheckoutError } from "./order.service.js";

const cashfreeHeaders = () => ({
  "Content-Type": "application/json",
  "x-api-version": CASHFREE_API_VERSION,
  "x-client-id": getCashfreeClientId(),
  "x-client-secret": getCashfreeClientSecret(),
});

const cashfreeRequest = async <T>(path: string, init: RequestInit): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`${getCashfreeApiBaseUrl()}${path}`, {
      ...init,
      signal: AbortSignal.timeout(15_000),
      headers: { ...cashfreeHeaders(), ...init.headers },
    });
  } catch {
    throw new CheckoutError("Cashfree is temporarily unavailable. Please try again.", 502);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new CheckoutError("Cashfree could not process this payment request.", 502);
  }
  return body as T;
};

const findExistingCashfreeOrder = async (
  cashfreeOrderId: string,
): Promise<CashfreeOrderResponse | null> => {
  try {
    return await cashfreeRequest<CashfreeOrderResponse>(
      `/orders/${encodeURIComponent(cashfreeOrderId)}`,
      { method: "GET" },
    );
  } catch {
    return null;
  }
};

interface CashfreeOrderResponse {
  order_id: string;
  payment_session_id: string;
  order_amount: number;
  order_currency: string;
}

interface CashfreePayment {
  cf_payment_id: string;
  payment_status: string;
  payment_amount: number;
  payment_currency: string;
  order_id: string;
}

export const createCashfreeOrderForCustomer = async (
  firebaseUid: string,
  orderId: string,
) => {
  const clientId = getCashfreeClientId();
  getCashfreeClientSecret();
  const { order, attempt } = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, user: { firebaseUid } },
      include: { paymentAttempts: { orderBy: { createdAt: "desc" } } },
    });
    if (!order) throw new CheckoutError("Order not found.", 404);
    if (
      order.orderStatus !== "PENDING_PAYMENT" ||
      ["SUCCESS", "REFUNDED"].includes(order.paymentStatus)
    ) {
      throw new CheckoutError("This order is not eligible for payment.", 409);
    }
    if (!Number.isSafeInteger(order.total) || order.total < 1) {
      throw new CheckoutError("The order amount is invalid.", 400);
    }
    const latest = order.paymentAttempts[0];
    if (
      latest?.provider === "CASHFREE" &&
      ["PENDING", "CREATED"].includes(latest.status) &&
      latest.amount === order.total
    ) {
      return { order, attempt: latest };
    }
    const attempt = await tx.paymentAttempt.create({
      data: { orderId: order.id, amount: order.total, status: "PENDING", provider: "CASHFREE" },
    });
    if (["FAILED", "CANCELLED"].includes(order.paymentStatus)) {
      await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: "PENDING" },
      });
    }
    return { order, attempt };
  });

  if (attempt.cashfreeOrderId) {
    const existing = await cashfreeRequest<CashfreeOrderResponse>(
      `/orders/${encodeURIComponent(attempt.cashfreeOrderId)}`,
      { method: "GET" },
    );
    return {
      orderId: order.id,
      paymentAttemptId: attempt.id,
      cashfreeOrderId: existing.order_id,
      paymentSessionId: existing.payment_session_id,
      amount: existing.order_amount,
      currency: existing.order_currency,
      clientId,
    };
  }

  const cashfreeOrderId = `MIN-${attempt.id}`;
  const gatewayOrder =
    (await findExistingCashfreeOrder(cashfreeOrderId)) ??
    (await cashfreeRequest<CashfreeOrderResponse>("/orders", {
      method: "POST",
      headers: { "x-idempotency-key": createHash("sha256").update(cashfreeOrderId).digest("hex") },
      body: JSON.stringify({
        order_id: cashfreeOrderId,
        order_amount: order.total,
        order_currency: "INR",
        customer_details: {
          customer_id: order.userId,
          customer_name: order.customerName,
          customer_email: order.customerEmail,
          customer_phone: order.customerPhone,
        },
        order_note: `Minutes order ${order.orderNumber}`,
      }),
    }));

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: { paymentStatus: "CREATED" },
    });
    await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        cashfreeOrderId: gatewayOrder.order_id,
        status: "CREATED",
        provider: "CASHFREE",
      },
    });
    await tx.payment.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        cashfreeOrderId: gatewayOrder.order_id,
        amount: order.total,
        status: "CREATED",
        provider: "CASHFREE",
      },
      update: {
        cashfreeOrderId: gatewayOrder.order_id,
        amount: order.total,
        status: "CREATED",
        provider: "CASHFREE",
      },
    });
  });

  return {
    orderId: order.id,
    paymentAttemptId: attempt.id,
    cashfreeOrderId: gatewayOrder.order_id,
    paymentSessionId: gatewayOrder.payment_session_id,
    amount: gatewayOrder.order_amount,
    currency: gatewayOrder.order_currency,
    clientId,
  };
};

interface VerificationInput {
  cashfree_order_id: unknown;
}

export const verifyCashfreePaymentForCustomer = async (
  firebaseUid: string,
  orderId: string,
  input: VerificationInput,
) => {
  if (
    !input ||
    typeof input.cashfree_order_id !== "string" ||
    !input.cashfree_order_id.trim()
  ) {
    throw new CheckoutError("Payment verification details are invalid.", 400);
  }
  const cashfreeOrderId = input.cashfree_order_id;
  const attempt = await prisma.paymentAttempt.findFirst({
    where: { orderId, cashfreeOrderId, provider: "CASHFREE" },
    include: { order: { include: { user: { select: { firebaseUid: true } } } } },
  });
  if (!attempt?.order || attempt.order.user.firebaseUid !== firebaseUid) {
    throw new CheckoutError("Payment attempt not found.", 404);
  }

  const payments = await cashfreeRequest<CashfreePayment[]>(
    `/orders/${encodeURIComponent(cashfreeOrderId)}/payments`,
    { method: "GET" },
  );
  const successful = payments.find(
    (payment) =>
      payment.payment_status === "SUCCESS" &&
      payment.order_id === cashfreeOrderId &&
      payment.payment_currency === "INR" &&
      payment.payment_amount === attempt.amount,
  );
  if (!successful) {
    throw new CheckoutError("The payment has not been completed.", 409);
  }

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.order.findUnique({ where: { id: orderId } });
    if (!current) throw new CheckoutError("Order not found.", 404);
    if (
      current.paymentStatus === "SUCCESS" &&
      ["CONFIRMED", "DELIVERED"].includes(current.orderStatus)
    ) {
      return { orderId, orderNumber: current.orderNumber, paymentStatus: "SUCCESS" as const, orderStatus: current.orderStatus, newlyConfirmed: false };
    }
    if (current.orderStatus !== "PENDING_PAYMENT") {
      throw new CheckoutError("The order is not eligible for payment confirmation.", 409);
    }
    await tx.order.update({ where: { id: orderId }, data: { paymentStatus: "SUCCESS", orderStatus: "CONFIRMED" } });
    await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "SUCCESS",
        cashfreePaymentId: successful.cf_payment_id,
        provider: "CASHFREE",
      },
    });
    await tx.payment.upsert({
      where: { orderId },
      create: {
        orderId,
        cashfreeOrderId,
        cashfreePaymentId: successful.cf_payment_id,
        amount: attempt.amount,
        status: "SUCCESS",
        provider: "CASHFREE",
      },
      update: {
        cashfreeOrderId,
        cashfreePaymentId: successful.cf_payment_id,
        amount: attempt.amount,
        status: "SUCCESS",
        provider: "CASHFREE",
      },
    });
    return { orderId, orderNumber: current.orderNumber, paymentStatus: "SUCCESS" as const, orderStatus: "CONFIRMED" as const, newlyConfirmed: true };
  });
  if (result.newlyConfirmed) void notifyOwner(orderId, "Cashfree");
  const { newlyConfirmed: _newlyConfirmed, ...publicResult } = result;
  return publicResult;
};
