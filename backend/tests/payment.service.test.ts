
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
const mocks = vi.hoisted(() => ({
  orderFindFirst: vi.fn(),
  orderFindUnique: vi.fn(),
  orderUpdateMany: vi.fn(),
  paymentAttemptFindFirst: vi.fn(),
  paymentAttemptFindUnique: vi.fn(),
  paymentAttemptCreate: vi.fn(),
  paymentAttemptUpdate: vi.fn(),
  paymentAttemptUpdateMany: vi.fn(),
  paymentUpsert: vi.fn(),
  transaction: vi.fn(),
  razorpayOrdersAll: vi.fn(),
  razorpayOrdersCreate: vi.fn(),
  razorpayPaymentsFetch: vi.fn(),
  getRazorpayClient: vi.fn(),
  getRazorpayKeyId: vi.fn(),
  getRazorpayKeySecret: vi.fn(),
}));

// Mock Prisma so the tests never access the real database.
vi.mock("../src/config/database.js", () => ({
  prisma: {
    order: {
      findFirst: mocks.orderFindFirst,
      findUnique: mocks.orderFindUnique,
      updateMany: mocks.orderUpdateMany,
    },
    paymentAttempt: {
      findFirst: mocks.paymentAttemptFindFirst,
      findUnique: mocks.paymentAttemptFindUnique,
      create: mocks.paymentAttemptCreate,
      update: mocks.paymentAttemptUpdate,
      updateMany: mocks.paymentAttemptUpdateMany,
    },
    payment: {
      upsert: mocks.paymentUpsert,
    },
    $transaction: mocks.transaction,
  },
}));

// Mock Razorpay so no real gateway requests or payments occur.
vi.mock("../src/config/razorpay.js", () => ({
  getRazorpayClient: mocks.getRazorpayClient,
  getRazorpayKeyId: mocks.getRazorpayKeyId,
  getRazorpayKeySecret: mocks.getRazorpayKeySecret,
}));

import {
  createRazorpayOrderForCustomer,
  verifyRazorpayPaymentForCustomer,
} from "../src/services/payment.service.js";

const attempt = {
  id: "attempt-1",
  orderId: "order-1",
  amount: 140,
  status: "PENDING",
  razorpayOrderId: null as string | null,
  createdAt: new Date(),
};

const order = {
  id: "order-1",
  orderNumber: "MIN-TEST123",
  total: 140,
  paymentStatus: "PENDING",
  orderStatus: "PENDING_PAYMENT",
  paymentAttempts: [attempt],
};

const tx = {
  order: {
    findFirst: mocks.orderFindFirst,
    findUnique: mocks.orderFindUnique,
    updateMany: mocks.orderUpdateMany,
  },
  paymentAttempt: {
    findFirst: mocks.paymentAttemptFindFirst,
    findUnique: mocks.paymentAttemptFindUnique,
    create: mocks.paymentAttemptCreate,
    update: mocks.paymentAttemptUpdate,
    updateMany: mocks.paymentAttemptUpdateMany,
  },
  payment: {
    upsert: mocks.paymentUpsert,
  },
};

describe("Razorpay order initialization", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Simulate Prisma transactions without a real database.
    mocks.transaction.mockImplementation(
      async (callback) => callback(tx)
    );

    mocks.orderFindFirst.mockResolvedValue(order);
    mocks.orderUpdateMany.mockResolvedValue({ count: 1 });

    mocks.paymentAttemptCreate.mockResolvedValue({
      ...attempt,
      id: "attempt-2",
    });

    mocks.paymentAttemptUpdate.mockResolvedValue({
      ...attempt,
      status: "CREATED",
      razorpayOrderId: "order_rzp_123",
    });

    mocks.paymentUpsert.mockResolvedValue({});

    mocks.getRazorpayKeyId.mockReturnValue("rzp_test_public");
    mocks.getRazorpayKeySecret.mockReturnValue("test_secret");

    mocks.getRazorpayClient.mockReturnValue({
      orders: {
        all: mocks.razorpayOrdersAll,
        create: mocks.razorpayOrdersCreate,
      },
      payments: {
        fetch: mocks.razorpayPaymentsFetch,
      },
    });

    mocks.paymentAttemptFindFirst.mockResolvedValue({
      ...attempt,
      razorpayOrderId: "order_rzp_123",
      order: {
        ...order,
        user: { firebaseUid: "firebase-user-1" },
      },
    });

    mocks.orderFindUnique.mockResolvedValue({
      id: "order-1",
      orderNumber: "MIN-TEST123",
      orderStatus: "PENDING_PAYMENT",
      paymentStatus: "PENDING",
    });

    mocks.paymentAttemptFindUnique.mockResolvedValue({
      id: "attempt-1",
      status: "CREATED",
      razorpayOrderId: "order_rzp_123",
      razorpayPaymentId: null,
    });

    mocks.paymentAttemptUpdateMany.mockResolvedValue({ count: 1 });

    mocks.razorpayPaymentsFetch.mockResolvedValue({
      id: "pay_123",
      order_id: "order_rzp_123",
      amount: 14000,
      currency: "INR",
      method: "upi",
      status: "captured",
      captured: true,
    });

    // By default, no gateway order exists for this receipt.
    mocks.razorpayOrdersAll.mockResolvedValue({
      items: [],
    });

    mocks.razorpayOrdersCreate.mockResolvedValue({
      id: "order_rzp_123",
      amount: 14000,
      currency: "INR",
      receipt: "MIN-attempt-1",
    });
  });

  it("creates a gateway order using the database amount in paise", async () => {
    const result = await createRazorpayOrderForCustomer(
      "firebase-user-1",
      "order-1"
    );

    expect(mocks.orderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "order-1",
          user: { firebaseUid: "firebase-user-1" },
        },
      })
    );

    expect(mocks.razorpayOrdersAll).toHaveBeenCalledWith({
      receipt: "MIN-attempt-1",
      count: 1,
    });

    // ₹140 must be sent to Razorpay as 14,000 paise.
    expect(mocks.razorpayOrdersCreate).toHaveBeenCalledWith({
      amount: 14000,
      currency: "INR",
      receipt: "MIN-attempt-1",
      partial_payment: false,
      notes: {
        minutesOrderId: "order-1",
        paymentAttemptId: "attempt-1",
        orderNumber: "MIN-TEST123",
      },
    });

    expect(mocks.paymentAttemptUpdate).toHaveBeenCalled();
    expect(mocks.paymentUpsert).toHaveBeenCalled();

    expect(result).toEqual({
      orderId: "order-1",
      paymentAttemptId: "attempt-1",
      razorpayOrderId: "order_rzp_123",
      amount: 14000,
      currency: "INR",
      keyId: "rzp_test_public",
    });
  });

  it("rejects an order that does not belong to the customer", async () => {
    mocks.orderFindFirst.mockResolvedValue(null);

    await expect(
      createRazorpayOrderForCustomer(
        "another-firebase-user",
        "order-1"
      )
    ).rejects.toMatchObject({
      message: "Order not found.",
      statusCode: 404,
    });

    expect(mocks.razorpayOrdersCreate).not.toHaveBeenCalled();
    expect(mocks.razorpayOrdersAll).not.toHaveBeenCalled();
  });

  it("reuses a saved Razorpay order on a retry", async () => {
    mocks.orderFindFirst.mockResolvedValue({
      ...order,
      paymentAttempts: [
        {
          ...attempt,
          razorpayOrderId: "order_rzp_existing",
        },
      ],
    });

    const result = await createRazorpayOrderForCustomer(
      "firebase-user-1",
      "order-1"
    );

    expect(result.razorpayOrderId).toBe("order_rzp_existing");
    expect(mocks.razorpayOrdersCreate).not.toHaveBeenCalled();
    expect(mocks.razorpayOrdersAll).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("recovers an existing gateway order by receipt without creating another", async () => {
    mocks.razorpayOrdersAll.mockResolvedValue({
      items: [
        {
          id: "order_rzp_recovered",
          amount: 14000,
          currency: "INR",
          receipt: "MIN-attempt-1",
        },
      ],
    });

    const result = await createRazorpayOrderForCustomer(
      "firebase-user-1",
      "order-1"
    );

    expect(result.razorpayOrderId).toBe("order_rzp_recovered");
    expect(mocks.razorpayOrdersCreate).not.toHaveBeenCalled();
    expect(mocks.paymentAttemptUpdate).toHaveBeenCalledWith({
      where: { id: "attempt-1" },
      data: {
        razorpayOrderId: "order_rzp_recovered",
        status: "CREATED",
      },
    });
    expect(mocks.paymentUpsert).toHaveBeenCalled();
  });

  it("recovers when gateway creation fails but the order now exists", async () => {
    mocks.razorpayOrdersAll
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [
          {
            id: "order_rzp_recovered",
            amount: 14000,
            currency: "INR",
            receipt: "MIN-attempt-1",
          },
        ],
      });

    mocks.razorpayOrdersCreate.mockRejectedValue(
      new Error("Duplicate receipt or lost response")
    );

    const result = await createRazorpayOrderForCustomer(
      "firebase-user-1",
      "order-1"
    );

    expect(result.razorpayOrderId).toBe("order_rzp_recovered");
    expect(mocks.razorpayOrdersCreate).toHaveBeenCalledOnce();
    expect(mocks.razorpayOrdersAll).toHaveBeenCalledTimes(2);
    expect(mocks.paymentAttemptUpdate).toHaveBeenCalled();
    expect(mocks.paymentUpsert).toHaveBeenCalled();
  });

  it("does not confirm an order when creation fails and recovery finds nothing", async () => {
    mocks.razorpayOrdersCreate.mockRejectedValue(
      new Error("Gateway unavailable")
    );

    await expect(
      createRazorpayOrderForCustomer(
        "firebase-user-1",
        "order-1"
      )
    ).rejects.toThrow("Gateway unavailable");

    expect(mocks.razorpayOrdersAll).toHaveBeenCalledTimes(2);
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
    expect(mocks.paymentAttemptUpdate).not.toHaveBeenCalled();
    expect(mocks.paymentUpsert).not.toHaveBeenCalled();
  });
});

const createPaymentSignature = (
  orderId = "order_rzp_123",
  paymentId = "pay_123"
) =>
  createHmac("sha256", "test_secret")
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

describe("Razorpay payment verification", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.transaction.mockImplementation(
      async (callback) => callback(tx)
    );

    mocks.getRazorpayKeySecret.mockReturnValue("test_secret");

    mocks.getRazorpayClient.mockReturnValue({
      orders: {
        all: mocks.razorpayOrdersAll,
        create: mocks.razorpayOrdersCreate,
      },
      payments: {
        fetch: mocks.razorpayPaymentsFetch,
      },
    });

    mocks.paymentAttemptFindFirst.mockResolvedValue({
      ...attempt,
      razorpayOrderId: "order_rzp_123",
      order: {
        ...order,
        user: { firebaseUid: "firebase-user-1" },
      },
    });

    mocks.razorpayPaymentsFetch.mockResolvedValue({
      id: "pay_123",
      order_id: "order_rzp_123",
      amount: 14000,
      currency: "INR",
      method: "upi",
      status: "captured",
      captured: true,
    });

    mocks.orderFindUnique.mockResolvedValue({
      id: "order-1",
      orderNumber: "MIN-TEST123",
      orderStatus: "PENDING_PAYMENT",
      paymentStatus: "PENDING",
    });

    mocks.paymentAttemptFindUnique.mockResolvedValue({
      id: "attempt-1",
      status: "CREATED",
      razorpayOrderId: "order_rzp_123",
      razorpayPaymentId: null,
    });

    mocks.orderUpdateMany.mockResolvedValue({ count: 1 });
    mocks.paymentAttemptUpdateMany.mockResolvedValue({ count: 1 });
    mocks.paymentUpsert.mockResolvedValue({});
  });

  it("confirms an order after verifying a captured UPI payment", async () => {
    const result = await verifyRazorpayPaymentForCustomer(
      "firebase-user-1",
      "order-1",
      {
        razorpay_order_id: "order_rzp_123",
        razorpay_payment_id: "pay_123",
        razorpay_signature: createPaymentSignature(),
      }
    );

    expect(mocks.razorpayPaymentsFetch).toHaveBeenCalledWith("pay_123");

    expect(mocks.orderUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "order-1",
        orderStatus: "PENDING_PAYMENT",
        paymentStatus: {
          in: ["PENDING", "CREATED", "FAILED"],
        },
      },
      data: {
        paymentStatus: "SUCCESS",
        orderStatus: "CONFIRMED",
      },
    });

    expect(mocks.paymentAttemptUpdateMany).toHaveBeenCalled();
    expect(mocks.paymentUpsert).toHaveBeenCalled();

    expect(result).toMatchObject({
      orderId: "order-1",
      paymentStatus: "SUCCESS",
      orderStatus: "CONFIRMED",
    });
  });

  it("rejects an invalid signature before fetching payment details", async () => {
    await expect(
      verifyRazorpayPaymentForCustomer(
        "firebase-user-1",
        "order-1",
        {
          razorpay_order_id: "order_rzp_123",
          razorpay_payment_id: "pay_123",
          razorpay_signature: "0".repeat(64),
        }
      )
    ).rejects.toMatchObject({
      message: "Payment signature is invalid.",
      statusCode: 400,
    });

    expect(mocks.razorpayPaymentsFetch).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects payment attempts belonging to another customer", async () => {
    mocks.paymentAttemptFindFirst.mockResolvedValue({
      ...attempt,
      razorpayOrderId: "order_rzp_123",
      order: {
        ...order,
        user: { firebaseUid: "another-customer" },
      },
    });

    await expect(
      verifyRazorpayPaymentForCustomer(
        "firebase-user-1",
        "order-1",
        {
          razorpay_order_id: "order_rzp_123",
          razorpay_payment_id: "pay_123",
          razorpay_signature: createPaymentSignature(),
        }
      )
    ).rejects.toMatchObject({
      message: "Payment attempt not found.",
      statusCode: 404,
    });

    expect(mocks.razorpayPaymentsFetch).not.toHaveBeenCalled();
  });

  it("does not confirm an authorized but uncaptured payment", async () => {
    mocks.razorpayPaymentsFetch.mockResolvedValue({
      id: "pay_123",
      order_id: "order_rzp_123",
      amount: 14000,
      currency: "INR",
      method: "upi",
      status: "authorized",
      captured: false,
    });

    await expect(
      verifyRazorpayPaymentForCustomer(
        "firebase-user-1",
        "order-1",
        {
          razorpay_order_id: "order_rzp_123",
          razorpay_payment_id: "pay_123",
          razorpay_signature: createPaymentSignature(),
        }
      )
    ).rejects.toMatchObject({
      message: expect.stringContaining("has not been captured"),
      statusCode: 409,
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a payment with an incorrect amount", async () => {
    mocks.razorpayPaymentsFetch.mockResolvedValue({
      id: "pay_123",
      order_id: "order_rzp_123",
      amount: 1000,
      currency: "INR",
      method: "upi",
      status: "captured",
      captured: true,
    });

    await expect(
      verifyRazorpayPaymentForCustomer(
        "firebase-user-1",
        "order-1",
        {
          razorpay_order_id: "order_rzp_123",
          razorpay_payment_id: "pay_123",
          razorpay_signature: createPaymentSignature(),
        }
      )
    ).rejects.toMatchObject({
      message: "The gateway payment does not match this order.",
      statusCode: 409,
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("accepts a repeated verification of the same successful payment", async () => {
    mocks.orderFindUnique.mockResolvedValue({
      id: "order-1",
      orderNumber: "MIN-TEST123",
      orderStatus: "CONFIRMED",
      paymentStatus: "SUCCESS",
    });

    mocks.paymentAttemptFindUnique.mockResolvedValue({
      id: "attempt-1",
      status: "SUCCESS",
      razorpayOrderId: "order_rzp_123",
      razorpayPaymentId: "pay_123",
    });

    const result = await verifyRazorpayPaymentForCustomer(
      "firebase-user-1",
      "order-1",
      {
        razorpay_order_id: "order_rzp_123",
        razorpay_payment_id: "pay_123",
        razorpay_signature: createPaymentSignature(),
      }
    );

    expect(result).toMatchObject({
      paymentStatus: "SUCCESS",
      orderStatus: "CONFIRMED",
    });

    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
    expect(mocks.paymentAttemptUpdateMany).not.toHaveBeenCalled();
    expect(mocks.paymentUpsert).not.toHaveBeenCalled();
  });
});
