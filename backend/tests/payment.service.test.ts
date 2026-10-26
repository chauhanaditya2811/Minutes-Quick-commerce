import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  orderUpdate: vi.fn(),
  attemptCreate: vi.fn(),
  attemptUpdate: vi.fn(),
  paymentUpsert: vi.fn(),
  transaction: vi.fn(),
  fetch: vi.fn(),
  notifyOwner: vi.fn(),
}));

vi.mock("../src/config/database.js", () => ({
  prisma: {
    order: { findFirst: mocks.findFirst, findUnique: mocks.findUnique, update: mocks.orderUpdate },
    paymentAttempt: { create: mocks.attemptCreate, update: mocks.attemptUpdate, findFirst: mocks.findFirst },
    payment: { upsert: mocks.paymentUpsert },
    $transaction: mocks.transaction,
  },
}));
vi.mock("../src/services/telegram.service.js", () => ({ notifyOwner: mocks.notifyOwner }));

import {
  createCashfreeOrderForCustomer,
  verifyCashfreePaymentForCustomer,
} from "../src/services/payment.service.js";

const tx = {
  order: { findFirst: mocks.findFirst, findUnique: mocks.findUnique, update: mocks.orderUpdate },
  paymentAttempt: { create: mocks.attemptCreate, update: mocks.attemptUpdate },
  payment: { upsert: mocks.paymentUpsert },
};

const baseOrder = {
  id: "order-1",
  userId: "user-1",
  orderNumber: "MIN-1",
  total: 140,
  paymentStatus: "PENDING",
  orderStatus: "PENDING_PAYMENT",
  customerName: "Customer",
  customerEmail: "customer@example.com",
  customerPhone: "9999999999",
  paymentAttempts: [],
  user: { firebaseUid: "firebase-1" },
};

const baseAttempt = {
  id: "attempt-1",
  orderId: "order-1",
  amount: 140,
  status: "PENDING",
  provider: "CASHFREE",
  cashfreeOrderId: null,
};

describe("Cashfree payment service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CASHFREE_CLIENT_ID = "test-client";
    process.env.CASHFREE_CLIENT_SECRET = "test-secret";
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    mocks.findFirst.mockResolvedValue({ ...baseOrder, paymentAttempts: [] });
    mocks.attemptCreate.mockResolvedValue(baseAttempt);
    mocks.attemptUpdate.mockResolvedValue({ ...baseAttempt, status: "CREATED", cashfreeOrderId: "MIN-attempt-1" });
    mocks.paymentUpsert.mockResolvedValue({});
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
      order_id: "MIN-attempt-1",
      payment_session_id: "session-1",
      order_amount: 140,
      order_currency: "INR",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("creates a Cashfree order using the server amount", async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        order_id: "MIN-attempt-1",
        payment_session_id: "session-1",
        order_amount: 140,
        order_currency: "INR",
      }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await createCashfreeOrderForCustomer("firebase-1", "order-1");
    expect(result.paymentSessionId).toBe("session-1");
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://sandbox.cashfree.com/pg/orders/MIN-attempt-1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://sandbox.cashfree.com/pg/orders",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body).order_amount).toBe(140);
  });

  it("does not create an additional payment attempt when a pending Cashfree attempt can be reused", async () => {
    mocks.findFirst.mockResolvedValue({
      ...baseOrder,
      paymentAttempts: [{ ...baseAttempt, cashfreeOrderId: "MIN-existing", status: "PENDING" }],
    });
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
      order_id: "MIN-existing", payment_session_id: "session-existing",
      order_amount: 140, order_currency: "INR",
    }), { status: 200 }));
    await createCashfreeOrderForCustomer("firebase-1", "order-1");
    expect(mocks.attemptCreate).not.toHaveBeenCalled();
  });

  it("returns a controlled error when Cashfree credentials are missing", async () => {
    delete process.env.CASHFREE_CLIENT_ID;
    await expect(createCashfreeOrderForCustomer("firebase-1", "order-1"))
      .rejects.toMatchObject({ name: "CashfreeConfigError" });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("handles Cashfree API failures without marking the order paid", async () => {
    mocks.fetch.mockResolvedValue(new Response("unauthorized", { status: 401 }));
    await expect(createCashfreeOrderForCustomer("firebase-1", "order-1"))
      .rejects.toMatchObject({ statusCode: 502 });
    expect(mocks.orderUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ data: expect.objectContaining({ paymentStatus: "SUCCESS" }) }),
    );
  });

  it("confirms a successful Cashfree payment", async () => {
    mocks.findFirst.mockResolvedValue({
      ...baseAttempt,
      cashfreeOrderId: "MIN-attempt-1",
      order: { ...baseOrder },
    });
    mocks.findUnique.mockResolvedValue({ ...baseOrder });
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify([{
      cf_payment_id: "cf-pay-1", payment_status: "SUCCESS", payment_amount: 140,
      payment_currency: "INR", order_id: "MIN-attempt-1",
    }]), { status: 200 }));
    const result = await verifyCashfreePaymentForCustomer("firebase-1", "order-1", {
      cashfree_order_id: "MIN-attempt-1",
    });
    expect(result.paymentStatus).toBe("SUCCESS");
    expect(mocks.paymentUpsert).toHaveBeenCalled();
  });

  it("rejects failed or mismatched payments", async () => {
    mocks.findFirst.mockResolvedValue({
      ...baseAttempt,
      cashfreeOrderId: "MIN-attempt-1",
      order: { ...baseOrder },
    });
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify([{
      cf_payment_id: "cf-pay-1", payment_status: "FAILED", payment_amount: 139,
      payment_currency: "INR", order_id: "MIN-attempt-1",
    }]), { status: 200 }));
    await expect(verifyCashfreePaymentForCustomer("firebase-1", "order-1", {
      cashfree_order_id: "MIN-attempt-1",
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.paymentUpsert).not.toHaveBeenCalled();
  });

  it("rejects payment attempts owned by another customer", async () => {
    mocks.findFirst.mockResolvedValue({
      ...baseAttempt,
      cashfreeOrderId: "MIN-attempt-1",
      order: { ...baseOrder, user: { firebaseUid: "another-user" } },
    });
    await expect(verifyCashfreePaymentForCustomer("firebase-1", "order-1", {
      cashfree_order_id: "MIN-attempt-1",
    })).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
