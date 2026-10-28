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
  notifyStockShortfall: vi.fn(),
  extendHold: vi.fn(),
  finalize: vi.fn(),
}));

vi.mock("../src/config/database.js", () => ({
  prisma: {
    order: { findFirst: mocks.findFirst, findUnique: mocks.findUnique, update: mocks.orderUpdate },
    paymentAttempt: { create: mocks.attemptCreate, update: mocks.attemptUpdate, findFirst: mocks.findFirst },
    payment: { upsert: mocks.paymentUpsert },
    $transaction: mocks.transaction,
  },
}));
vi.mock("../src/services/telegram.service.js", () => ({
  notifyOwner: mocks.notifyOwner,
  notifyStockShortfall: mocks.notifyStockShortfall,
}));
// Stock holds and order finalisation are covered against a real database in tests/inventory.
vi.mock("../src/services/inventory.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/inventory.service.js")>()),
  extendOrClaimReservations: mocks.extendHold,
}));
vi.mock("../src/services/order.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/order.service.js")>()),
  finalizePaidOrder: mocks.finalize,
}));

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
  hostelId: "hostel-1",
  paymentAttempts: [],
  items: [{ productId: "product-1", productName: "Maggi", quantity: 2 }],
  user: { firebaseUid: "firebase-1" },
};

const holdExpiresAt = new Date("2026-10-29T10:15:00.000Z");

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
    mocks.extendHold.mockResolvedValue(holdExpiresAt);
    mocks.finalize.mockResolvedValue({
      order: { ...baseOrder, paymentStatus: "SUCCESS", orderStatus: "CONFIRMED" },
      newlyConfirmed: true,
      shortfall: false,
    });
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
    const body = JSON.parse(mocks.fetch.mock.calls[1][1].body);
    expect(body.order_amount).toBe(140);
    expect(body.order_expiry_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/);
    expect(result.holdExpiresAt).toEqual(holdExpiresAt);
    expect(mocks.extendHold).toHaveBeenCalledWith(tx, {
      id: "order-1",
      userId: "user-1",
      hostelId: "hostel-1",
      items: [{ productId: "product-1", productName: "Maggi", quantity: 2 }],
    });
  });

  it("refuses to start payment when the order's stock can no longer be held", async () => {
    const { InventoryReservationError } = await import("../src/services/inventory.service.js");
    mocks.extendHold.mockRejectedValue(new InventoryReservationError("Maggi is no longer available in the quantity you selected."));
    await expect(createCashfreeOrderForCustomer("firebase-1", "order-1"))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.attemptCreate).not.toHaveBeenCalled();
  });

  it("starts a fresh attempt when the earlier Cashfree order has expired", async () => {
    mocks.findFirst.mockResolvedValue({
      ...baseOrder,
      paymentAttempts: [{ ...baseAttempt, cashfreeOrderId: "MIN-old", status: "CREATED" }],
    });
    mocks.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        order_id: "MIN-old", payment_session_id: "old", order_amount: 140, order_currency: "INR", order_status: "EXPIRED",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        order_id: "MIN-attempt-1", payment_session_id: "session-new", order_amount: 140, order_currency: "INR",
      }), { status: 200 }));
    const result = await createCashfreeOrderForCustomer("firebase-1", "order-1");
    expect(mocks.attemptCreate).toHaveBeenCalledOnce();
    expect(result.paymentSessionId).toBe("session-new");
  });

  it("does not create an additional payment attempt when a pending Cashfree attempt can be reused", async () => {
    mocks.findFirst.mockResolvedValue({
      ...baseOrder,
      paymentAttempts: [{ ...baseAttempt, cashfreeOrderId: "MIN-existing", status: "PENDING" }],
    });
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
      order_id: "MIN-existing", payment_session_id: "session-existing",
      order_amount: 140, order_currency: "INR", order_status: "ACTIVE",
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
    expect(result).toEqual({ orderId: "order-1", orderNumber: "MIN-1", paymentStatus: "SUCCESS", orderStatus: "CONFIRMED" });
    expect(mocks.finalize).toHaveBeenCalledWith(tx, {
      orderId: "order-1",
      attemptId: "attempt-1",
      cashfreeOrderId: "MIN-attempt-1",
      cashfreePaymentId: "cf-pay-1",
      amount: 140,
    });
    expect(mocks.notifyOwner).toHaveBeenCalledWith("order-1", "Cashfree");
  });

  it("does not notify again when the payment was already confirmed by the webhook", async () => {
    mocks.findFirst.mockResolvedValue({ ...baseAttempt, cashfreeOrderId: "MIN-attempt-1", order: { ...baseOrder } });
    mocks.finalize.mockResolvedValue({
      order: { ...baseOrder, paymentStatus: "SUCCESS", orderStatus: "CONFIRMED" },
      newlyConfirmed: false,
      shortfall: false,
    });
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify([{
      cf_payment_id: "cf-pay-1", payment_status: "SUCCESS", payment_amount: 140,
      payment_currency: "INR", order_id: "MIN-attempt-1",
    }]), { status: 200 }));
    const result = await verifyCashfreePaymentForCustomer("firebase-1", "order-1", { cashfree_order_id: "MIN-attempt-1" });
    expect(result.orderStatus).toBe("CONFIRMED");
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
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
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it("rejects payment attempts owned by another customer", async () => {
    // Ownership is part of the query, so another customer's attempt is simply not found.
    mocks.findFirst.mockResolvedValue(null);
    await expect(verifyCashfreePaymentForCustomer("firebase-1", "order-1", {
      cashfree_order_id: "MIN-attempt-1",
    })).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ order: { user: { firebaseUid: "firebase-1" } } }),
    }));
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("scopes guest payment verification to the guest's own order token", async () => {
    const { verifyCashfreePaymentForOwner } = await import("../src/services/payment.service.js");
    mocks.findFirst.mockResolvedValue(null);
    await expect(verifyCashfreePaymentForOwner({ guestTokenHash: "hash-1" }, "order-1", {
      cashfree_order_id: "MIN-attempt-1",
    })).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ order: { userId: null, guestAccessTokenHash: "hash-1" } }),
    }));
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("creates a Cashfree order for a guest without an account or email", async () => {
    const { createCashfreeOrderForOwner } = await import("../src/services/payment.service.js");
    mocks.findFirst.mockResolvedValue({ ...baseOrder, userId: null, customerEmail: null, paymentAttempts: [] });
    mocks.fetch
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        order_id: "MIN-attempt-1", payment_session_id: "session-guest", order_amount: 140, order_currency: "INR",
      }), { status: 200 }));

    const result = await createCashfreeOrderForOwner({ guestTokenHash: "hash-1" }, "order-1");

    expect(result.paymentSessionId).toBe("session-guest");
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "order-1", userId: null, guestAccessTokenHash: "hash-1" },
    }));
    const customer = JSON.parse(mocks.fetch.mock.calls[1][1].body).customer_details;
    expect(customer).toEqual({ customer_id: "guest_order-1", customer_name: "Customer", customer_phone: "9999999999" });
  });
});
