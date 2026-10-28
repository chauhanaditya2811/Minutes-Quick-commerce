import { createHash } from "node:crypto";
import { prisma } from "../config/database.js";
import {
  CASHFREE_API_VERSION,
  getCashfreeApiBaseUrl,
  getCashfreeClientId,
  getCashfreeClientSecret,
} from "../config/cashfree.js";
import { notifyOwner, notifyStockShortfall } from "./telegram.service.js";
import { CheckoutError, finalizePaidOrder } from "./order.service.js";
import { InventoryReservationError, extendOrClaimReservations } from "./inventory.service.js";

// Cashfree requires an order expiry comfortably in the future; payments after the stock hold
// ends are still handled safely by finalizePaidOrder's late-payment path.
const MIN_CASHFREE_EXPIRY_MS = 16 * 60_000;

// Cashfree documents order_expiry_time as ISO 8601 with an offset, e.g. 2026-10-29T10:20:12+05:30.
const toCashfreeExpiry = (holdExpiresAt: Date) => {
  const expiry = new Date(Math.max(holdExpiresAt.getTime(), Date.now() + MIN_CASHFREE_EXPIRY_MS));
  const ist = new Date(expiry.getTime() + 330 * 60_000);
  return `${ist.toISOString().slice(0, 19)}+05:30`;
};

const getCashfreeNotifyUrl = () => {
  const configuredUrl = process.env.CASHFREE_WEBHOOK_URL?.trim();
  if (configuredUrl) return configuredUrl;

  // Production defaults to the registered Azure endpoint; non-production can opt in via CASHFREE_WEBHOOK_URL.
  return process.env.CASHFREE_ENVIRONMENT?.trim().toLowerCase() === "production"
    ? "https://minutes-api-hostel-dqgtbzekgjbdaca0.indiasouthcentral-01.azurewebsites.net/api/webhooks/cashfree"
    : undefined;
};

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
  order_status?: string;
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
  const prepared = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, user: { firebaseUid } },
      include: { paymentAttempts: { orderBy: { createdAt: "desc" } }, items: true },
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
    // Keep (or re-take) this order's stock hold for as long as the customer is paying.
    let holdExpiresAt: Date | null;
    try {
      holdExpiresAt = await extendOrClaimReservations(tx, {
        id: order.id,
        userId: order.userId,
        hostelId: order.hostelId,
        items: order.items.map(({ productId, productName, quantity }) => ({ productId, productName, quantity })),
      });
    } catch (error) {
      if (error instanceof InventoryReservationError) {
        throw new CheckoutError(`${error.message} Please review your cart and place a new order.`, error.statusCode);
      }
      throw error;
    }
    const latest = order.paymentAttempts[0];
    if (
      latest?.provider === "CASHFREE" &&
      ["PENDING", "CREATED"].includes(latest.status) &&
      latest.amount === order.total
    ) {
      return { order, attempt: latest, holdExpiresAt };
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
    return { order, attempt, holdExpiresAt };
  });
  const { order, holdExpiresAt } = prepared;
  let { attempt } = prepared;

  if (attempt.cashfreeOrderId) {
    const existing = await cashfreeRequest<CashfreeOrderResponse>(
      `/orders/${encodeURIComponent(attempt.cashfreeOrderId)}`,
      { method: "GET" },
    );
    if (!existing.order_status || existing.order_status === "ACTIVE") {
      return {
        orderId: order.id,
        paymentAttemptId: attempt.id,
        cashfreeOrderId: existing.order_id,
        paymentSessionId: existing.payment_session_id,
        amount: existing.order_amount,
        currency: existing.order_currency,
        clientId,
        holdExpiresAt,
      };
    }
    // The earlier Cashfree order expired or was terminated: start a fresh attempt.
    attempt = await prisma.paymentAttempt.create({
      data: { orderId: order.id, amount: order.total, status: "PENDING", provider: "CASHFREE" },
    });
  }

  const cashfreeOrderId = `MIN-${attempt.id}`;
  const notifyUrl = getCashfreeNotifyUrl();
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
        ...(notifyUrl ? { order_meta: { notify_url: notifyUrl } } : {}),
        ...(holdExpiresAt ? { order_expiry_time: toCashfreeExpiry(holdExpiresAt) } : {}),
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
    holdExpiresAt,
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

  const result = await prisma.$transaction((tx) =>
    finalizePaidOrder(tx, {
      orderId,
      attemptId: attempt.id,
      cashfreeOrderId,
      cashfreePaymentId: successful.cf_payment_id,
      amount: attempt.amount,
    })
  );
  if (result.newlyConfirmed) void notifyOwner(orderId, "Cashfree");
  if (result.shortfall) void notifyStockShortfall(orderId);
  return {
    orderId,
    orderNumber: result.order.orderNumber,
    paymentStatus: "SUCCESS" as const,
    orderStatus: result.order.orderStatus,
  };
};
