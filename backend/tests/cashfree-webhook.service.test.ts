import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventFindUnique: vi.fn(),
  eventCreate: vi.fn(),
  attemptFindFirst: vi.fn(),
  attemptUpdate: vi.fn(),
  orderUpdate: vi.fn(),
  paymentUpsert: vi.fn(),
  transaction: vi.fn(),
  notifyOwner: vi.fn(),
  notifyStockShortfall: vi.fn(),
  finalize: vi.fn(),
  recordFailed: vi.fn(),
}));

vi.mock("../src/config/database.js", () => ({
  prisma: {
    cashfreeWebhookEvent: {
      findUnique: mocks.eventFindUnique,
      create: mocks.eventCreate,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock("../src/config/cashfree.js", () => ({
  getCashfreeWebhookSecret: () => "webhook-secret",
}));
vi.mock("../src/services/telegram.service.js", () => ({
  notifyOwner: mocks.notifyOwner,
  notifyStockShortfall: mocks.notifyStockShortfall,
}));
// Stock and order transitions are covered against a real database in tests/inventory.
vi.mock("../src/services/order.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/order.service.js")>()),
  finalizePaidOrder: mocks.finalize,
  recordFailedPaymentAttempt: mocks.recordFailed,
}));

import { processCashfreeWebhook } from "../src/services/cashfree-webhook.service.js";

const tx = {
  cashfreeWebhookEvent: { findUnique: mocks.eventFindUnique, create: mocks.eventCreate },
  paymentAttempt: { findFirst: mocks.attemptFindFirst, update: mocks.attemptUpdate },
  order: { update: mocks.orderUpdate },
  payment: { upsert: mocks.paymentUpsert },
};

const payload = (status = "SUCCESS") => JSON.stringify({
  type: status === "SUCCESS" ? "PAYMENT_SUCCESS_WEBHOOK" : "PAYMENT_FAILED_WEBHOOK",
  data: {
    order: { order_id: "MIN-attempt-1", order_amount: 140, order_currency: "INR" },
    payment: {
      cf_payment_id: "cf-pay-1",
      payment_status: status,
      payment_amount: 140,
      payment_currency: "INR",
    },
  },
});

const signed = (body: string) => ({
  body: Buffer.from(body),
  signature: createHmac("sha256", "webhook-secret")
    .update(`1700000000${body}`)
    .digest("base64"),
  timestamp: "1700000000",
});

describe("Cashfree webhook service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CASHFREE_CLIENT_SECRET = "webhook-secret";
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    mocks.eventFindUnique.mockResolvedValue(null);
    mocks.eventCreate.mockResolvedValue({});
    mocks.attemptFindFirst.mockResolvedValue({
      id: "attempt-1",
      amount: 140,
      provider: "CASHFREE",
      cashfreeOrderId: "MIN-attempt-1",
      order: {
        id: "order-1",
        total: 140,
        paymentStatus: "PENDING",
        orderStatus: "PENDING_PAYMENT",
      },
    });
    mocks.notifyOwner.mockResolvedValue(undefined);
    mocks.finalize.mockResolvedValue({ order: { id: "order-1" }, newlyConfirmed: true, shortfall: false });
    mocks.recordFailed.mockResolvedValue(undefined);
  });

  const verifiedPayment = {
    orderId: "order-1",
    attemptId: "attempt-1",
    cashfreeOrderId: "MIN-attempt-1",
    cashfreePaymentId: "cf-pay-1",
    amount: 140,
  };

  it("rejects an invalid signature before opening a transaction", async () => {
    const request = signed(payload());
    await expect(processCashfreeWebhook(request.body, "invalid", request.timestamp))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("processes a valid success webhook", async () => {
    const request = signed(payload());
    const result = await processCashfreeWebhook(request.body, request.signature, request.timestamp, "event-1");
    expect(result).toMatchObject({ processed: true, paymentStatus: "SUCCESS" });
    expect(mocks.finalize).toHaveBeenCalledWith(tx, verifiedPayment);
    expect(mocks.notifyOwner).toHaveBeenCalledOnce();
    expect(mocks.notifyStockShortfall).not.toHaveBeenCalled();
    expect(mocks.notifyOwner).toHaveBeenCalledWith("order-1");
    expect(result).not.toHaveProperty("newlyConfirmed");
  });

  it("does not process duplicate deliveries twice", async () => {
    mocks.eventFindUnique.mockResolvedValue({ eventId: "event-1" });
    const request = signed(payload());
    const result = await processCashfreeWebhook(request.body, request.signature, request.timestamp, "event-1");
    expect(result).toMatchObject({ processed: false, reason: "duplicate_event" });
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
  });

  it("records failed payments without confirming the order", async () => {
    const request = signed(payload("FAILED"));
    const result = await processCashfreeWebhook(request.body, request.signature, request.timestamp, "event-2");
    expect(result).toMatchObject({ processed: true, paymentStatus: "FAILED" });
    expect(mocks.recordFailed).toHaveBeenCalledWith(tx, {
      orderId: "order-1",
      attemptId: "attempt-1",
      cashfreePaymentId: "cf-pay-1",
    });
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
  });

  it("rejects mismatched amounts", async () => {
    const body = payload().replace('"payment_amount":140', '"payment_amount":139');
    const request = signed(body);
    await expect(processCashfreeWebhook(request.body, request.signature, request.timestamp, "event-3"))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
  });

  it("does not notify for an already-confirmed order", async () => {
    mocks.finalize.mockResolvedValue({ order: { id: "order-1" }, newlyConfirmed: false, shortfall: false });
    mocks.attemptFindFirst.mockResolvedValue({
      id: "attempt-1",
      amount: 140,
      provider: "CASHFREE",
      cashfreeOrderId: "MIN-attempt-1",
      order: {
        id: "order-1",
        total: 140,
        paymentStatus: "SUCCESS",
        orderStatus: "CONFIRMED",
      },
    });
    const request = signed(payload());
    const result = await processCashfreeWebhook(request.body, request.signature, request.timestamp, "event-4");
    expect(result).toMatchObject({ processed: false, reason: "already_processed" });
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
  });

  it("alerts the owner when a paid order found less stock than ordered", async () => {
    mocks.finalize.mockResolvedValue({ order: { id: "order-1" }, newlyConfirmed: true, shortfall: true });
    const request = signed(payload());
    const result = await processCashfreeWebhook(request.body, request.signature, request.timestamp, "event-7");
    expect(result).toMatchObject({ processed: true, paymentStatus: "SUCCESS" });
    expect(result).not.toHaveProperty("shortfall");
    expect(mocks.notifyStockShortfall).toHaveBeenCalledWith("order-1");
  });

  it("rejects confirmation of an order that is no longer payable", async () => {
    const { CheckoutError } = await import("../src/services/order.service.js");
    mocks.finalize.mockRejectedValue(new CheckoutError("The order is not eligible for payment confirmation.", 409));
    const request = signed(payload());
    await expect(processCashfreeWebhook(request.body, request.signature, request.timestamp, "event-8"))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
  });

  it("does not notify when the transaction fails", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("database unavailable"));
    const request = signed(payload());
    await expect(processCashfreeWebhook(request.body, request.signature, request.timestamp, "event-5"))
      .rejects.toThrow("database unavailable");
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
  });

  it("keeps a confirmed payment processed when Telegram notification fails", async () => {
    mocks.notifyOwner.mockRejectedValueOnce(new Error("Telegram unavailable"));
    const request = signed(payload());
    const result = await processCashfreeWebhook(request.body, request.signature, request.timestamp, "event-6");
    await new Promise((resolve) => setImmediate(resolve));
    expect(result).toMatchObject({ processed: true, paymentStatus: "SUCCESS" });
    expect(mocks.finalize).toHaveBeenCalled();
    expect(mocks.notifyOwner).toHaveBeenCalledWith("order-1");
  });
});
