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
  });

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
    expect(mocks.orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { paymentStatus: "SUCCESS", orderStatus: "CONFIRMED" } }),
    );
    expect(mocks.notifyOwner).toHaveBeenCalledOnce();
    expect(mocks.notifyOwner).toHaveBeenCalledWith("order-1", "Cashfree");
    expect(result).not.toHaveProperty("newlyConfirmed");
  });

  it("does not process duplicate deliveries twice", async () => {
    mocks.eventFindUnique.mockResolvedValue({ eventId: "event-1" });
    const request = signed(payload());
    const result = await processCashfreeWebhook(request.body, request.signature, request.timestamp, "event-1");
    expect(result).toMatchObject({ processed: false, reason: "duplicate_event" });
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
  });

  it("records failed payments without confirming the order", async () => {
    const request = signed(payload("FAILED"));
    const result = await processCashfreeWebhook(request.body, request.signature, request.timestamp, "event-2");
    expect(result).toMatchObject({ processed: true, paymentStatus: "FAILED" });
    expect(mocks.orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { paymentStatus: "FAILED" } }),
    );
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
  });

  it("rejects mismatched amounts", async () => {
    const body = payload().replace('"payment_amount":140', '"payment_amount":139');
    const request = signed(body);
    await expect(processCashfreeWebhook(request.body, request.signature, request.timestamp, "event-3"))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
  });

  it("does not notify for an already-confirmed order", async () => {
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
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
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
    expect(mocks.orderUpdate).toHaveBeenCalled();
    expect(mocks.notifyOwner).toHaveBeenCalledWith("order-1", "Cashfree");
  });
});
