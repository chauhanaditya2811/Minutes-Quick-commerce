
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRazorpayWebhookSecret: vi.fn(),
  paymentAttemptFindFirst: vi.fn(),
  orderFindUnique: vi.fn(),
  orderUpdateMany: vi.fn(),
  paymentAttemptFindUnique: vi.fn(),
  paymentAttemptUpdateMany: vi.fn(),
  paymentUpsert: vi.fn(),
  webhookEventFindUnique: vi.fn(),
  webhookEventCreate: vi.fn(),
  transaction: vi.fn(),
}));

// Mock Prisma so these tests never change the real database.
vi.mock("../src/config/database.js", () => ({
  prisma: {
    paymentAttempt: {
      findFirst: mocks.paymentAttemptFindFirst,
    },
    razorpayWebhookEvent: {
      findUnique: mocks.webhookEventFindUnique,
      create: mocks.webhookEventCreate,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("../src/config/razorpay.js", () => ({
  getRazorpayWebhookSecret: mocks.getRazorpayWebhookSecret,
}));

import {
  processRazorpayWebhook,
  RazorpayWebhookError,
} from "../src/services/razorpay-webhook.service.js";

const tx = {
  order: {
    findUnique: mocks.orderFindUnique,
    updateMany: mocks.orderUpdateMany,
  },
  paymentAttempt: {
    findUnique: mocks.paymentAttemptFindUnique,
    updateMany: mocks.paymentAttemptUpdateMany,
  },
  payment: {
    upsert: mocks.paymentUpsert,
  },
  razorpayWebhookEvent: {
    findUnique: mocks.webhookEventFindUnique,
    create: mocks.webhookEventCreate,
  },
};

const attempt = {
  id: "attempt-1",
  orderId: "order-1",
  razorpayOrderId: "order_rzp_123",
  razorpayPaymentId: null as string | null,
  amount: 140,
  status: "CREATED",
  order: {
    id: "order-1",
    orderNumber: "MIN-TEST123",
    total: 140,
    paymentStatus: "CREATED",
    orderStatus: "PENDING_PAYMENT",
  },
};

const currentOrder = {
  id: "order-1",
  orderNumber: "MIN-TEST123",
  total: 140,
  paymentStatus: "CREATED",
  orderStatus: "PENDING_PAYMENT",
  payment: {
    razorpayOrderId: "order_rzp_123",
  },
};

const currentAttempt = {
  id: "attempt-1",
  orderId: "order-1",
  razorpayOrderId: "order_rzp_123",
  razorpayPaymentId: null as string | null,
  amount: 140,
  status: "CREATED",
};

// Construct a correctly signed webhook using the test secret.
const makeSignedBody = (event: string, overrides: Record<string, unknown> = {}) => {
  const entity = {
    id: "pay_123",
    order_id: "order_rzp_123",
    amount: 14000,
    currency: "INR",
    method: "upi",
    status: event === "payment.failed" ? "failed" : "captured",
    captured: event !== "payment.failed",
    ...overrides,
  };

  const rawBody = Buffer.from(
    JSON.stringify({
      event,
      payload: {
        payment: {
          entity,
        },
      },
    }),
    "utf8"
  );

  const signature = createHmac("sha256", "test_webhook_secret")
    .update(rawBody)
    .digest("hex");

  return { rawBody, signature };
};

describe("Razorpay webhook service", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.getRazorpayWebhookSecret.mockReturnValue(
      "test_webhook_secret"
    );

    mocks.paymentAttemptFindFirst.mockResolvedValue(attempt);
    mocks.orderFindUnique.mockResolvedValue(currentOrder);
    mocks.paymentAttemptFindUnique.mockResolvedValue(currentAttempt);

    mocks.orderUpdateMany.mockResolvedValue({ count: 1 });
    mocks.paymentAttemptUpdateMany.mockResolvedValue({ count: 1 });
    mocks.paymentUpsert.mockResolvedValue({});
    mocks.webhookEventFindUnique.mockResolvedValue(null);
    mocks.webhookEventCreate.mockResolvedValue({});

    mocks.transaction.mockImplementation(
      async (callback) => callback(tx)
    );
  });

  it("rejects an invalid signature before accessing the database", async () => {
    const { rawBody } = makeSignedBody("payment.captured");

    await expect(
      processRazorpayWebhook(rawBody, "0".repeat(64), "evt_sig_123")
    ).rejects.toMatchObject({
      message: "Razorpay webhook signature verification failed.",
      statusCode: 400,
    });

    expect(mocks.paymentAttemptFindFirst).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a missing or blank event ID", async () => {
    const { rawBody, signature } = makeSignedBody("payment.captured");

    await expect(
      processRazorpayWebhook(rawBody, signature, undefined)
    ).rejects.toMatchObject({
      message: "The Razorpay webhook event ID is required.",
      statusCode: 400,
    });

    await expect(
      processRazorpayWebhook(rawBody, signature, "   ")
    ).rejects.toMatchObject({
      message: "The Razorpay webhook event ID is required.",
      statusCode: 400,
    });

    expect(mocks.paymentAttemptFindFirst).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("confirms the order for a valid captured UPI payment", async () => {
    const eventId = "evt_captured_123";
    const { rawBody, signature } = makeSignedBody("payment.captured");

    const result = await processRazorpayWebhook(
      rawBody,
      signature,
      eventId
    );

    expect(mocks.paymentAttemptFindFirst).toHaveBeenCalledWith({
      where: { razorpayOrderId: "order_rzp_123" },
      include: { order: true },
    });

    expect(mocks.webhookEventFindUnique).toHaveBeenCalledWith({
      where: { eventId },
      select: { eventId: true },
    });

    expect(mocks.webhookEventCreate).toHaveBeenCalledWith({
      data: {
        eventId,
        eventType: "payment.captured",
      },
    });

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
      received: true,
      processed: true,
      event: "payment.captured",
      orderId: "order-1",
      paymentStatus: "SUCCESS",
      orderStatus: "CONFIRMED",
    });
  });

  it.each(["card", "netbanking", "wallet"])(
    "confirms the order for a valid captured %s payment",
    async (method) => {
      const { rawBody, signature } = makeSignedBody("payment.captured", {
        method,
      });

      await expect(
        processRazorpayWebhook(rawBody, signature, `evt_${method}_123`)
      ).resolves.toMatchObject({
        received: true,
        processed: true,
        paymentStatus: "SUCCESS",
      });
    }
  );

  it("rejects a captured webhook payment with an unsupported method", async () => {
    const { rawBody, signature } = makeSignedBody("payment.captured", {
      method: "emi",
    });

    await expect(
      processRazorpayWebhook(rawBody, signature, "evt_unsupported_method_123")
    ).rejects.toMatchObject({
      message: "The captured payment is not a supported payment method.",
      statusCode: 409,
    });

    expect(mocks.paymentAttemptFindFirst).not.toHaveBeenCalled();
  });

  it("rejects a captured payment with an incorrect amount", async () => {
    const { rawBody, signature } = makeSignedBody(
      "payment.captured",
      { amount: 1000 }
    );

    await expect(
      processRazorpayWebhook(rawBody, signature, "evt_amount_123")
    ).rejects.toMatchObject({
      message: "The webhook payment does not match the stored order amount.",
      statusCode: 409,
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("records a failed payment without confirming the order", async () => {
    const { rawBody, signature } = makeSignedBody("payment.failed");

    const result = await processRazorpayWebhook(
      rawBody,
      signature,
      "evt_failed_123"
    );

    expect(mocks.orderUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "order-1",
        orderStatus: "PENDING_PAYMENT",
        paymentStatus: {
          in: ["PENDING", "CREATED", "FAILED"],
        },
      },
      data: {
        paymentStatus: "FAILED",
      },
    });

    expect(mocks.paymentAttemptUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: "FAILED",
          razorpayPaymentId: "pay_123",
        },
      })
    );

    expect(result).toMatchObject({
      received: true,
      processed: true,
      event: "payment.failed",
      paymentStatus: "FAILED",
      orderStatus: "PENDING_PAYMENT",
    });
  });

  it("does not process a repeated captured event twice", async () => {
    mocks.orderFindUnique.mockResolvedValue({
      ...currentOrder,
      paymentStatus: "SUCCESS",
      orderStatus: "CONFIRMED",
    });

    mocks.paymentAttemptFindUnique.mockResolvedValue({
      ...currentAttempt,
      status: "SUCCESS",
      razorpayPaymentId: "pay_123",
    });

    mocks.webhookEventFindUnique.mockResolvedValue({ eventId: "evt_repeated_123" });

    const { rawBody, signature } = makeSignedBody("payment.captured");

    const result = await processRazorpayWebhook(
      rawBody,
      signature,
      "evt_repeated_123"
    );

    expect(result).toMatchObject({
      received: true,
      processed: false,
      reason: "duplicate_event",
    });

    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
    expect(mocks.paymentAttemptUpdateMany).not.toHaveBeenCalled();
    expect(mocks.paymentUpsert).not.toHaveBeenCalled();
  });

  it("does not downgrade an order after a delayed failure event", async () => {
    mocks.orderFindUnique.mockResolvedValue({
      ...currentOrder,
      paymentStatus: "SUCCESS",
      orderStatus: "CONFIRMED",
    });

    mocks.paymentAttemptFindUnique.mockResolvedValue({
      ...currentAttempt,
      status: "SUCCESS",
      razorpayPaymentId: "pay_123",
    });

    const { rawBody, signature } = makeSignedBody("payment.failed");

    const result = await processRazorpayWebhook(
      rawBody,
      signature,
      "evt_delayed_failed_123"
    );

    expect(result).toMatchObject({
      received: true,
      processed: false,
      reason: "order_already_paid",
    });

    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
    expect(mocks.paymentAttemptUpdateMany).not.toHaveBeenCalled();
  });

  it("acknowledges a valid but unsupported event and records it", async () => {
    const rawBody = Buffer.from(
      JSON.stringify({ event: "some.other.event" }),
      "utf8"
    );

    const signature = createHmac("sha256", "test_webhook_secret")
      .update(rawBody)
      .digest("hex");

    const result = await processRazorpayWebhook(
      rawBody,
      signature,
      "evt_unsupported_123"
    );

    expect(result).toEqual({
      received: true,
      processed: false,
      event: "some.other.event",
      reason: "unsupported_event",
    });

    expect(mocks.webhookEventCreate).toHaveBeenCalledWith({
      data: {
        eventId: "evt_unsupported_123",
        eventType: "some.other.event",
      },
    });

    expect(mocks.paymentAttemptFindFirst).not.toHaveBeenCalled();
  });

  it("acknowledges a unique-event conflict safely", async () => {
    mocks.transaction.mockRejectedValueOnce({
      code: "P2002",
      meta: {
        target: ["eventId"],
      },
    });

    const rawBody = Buffer.from(
      JSON.stringify({ event: "some.other.event" }),
      "utf8"
    );

    const signature = createHmac("sha256", "test_webhook_secret")
      .update(rawBody)
      .digest("hex");

    await expect(
      processRazorpayWebhook(rawBody, signature, "evt_conflict_123")
    ).resolves.toMatchObject({
      received: true,
      processed: false,
      event: "some.other.event",
      reason: "duplicate_event",
    });
  });

  it("propagates unrelated database errors instead of swallowing them", async () => {
    const rawBody = Buffer.from(
      JSON.stringify({ event: "some.other.event" }),
      "utf8"
    );

    const signature = createHmac("sha256", "test_webhook_secret")
      .update(rawBody)
      .digest("hex");

    mocks.webhookEventCreate.mockRejectedValueOnce(
      new Error("db exploded")
    );

    await expect(
      processRazorpayWebhook(rawBody, signature, "evt_db_error_123")
    ).rejects.toThrow("db exploded");
  });

  it("rejects a missing raw request body", async () => {
    await expect(
      processRazorpayWebhook(Buffer.alloc(0), undefined, "evt_missing_body_123")
    ).rejects.toBeInstanceOf(RazorpayWebhookError);

    expect(mocks.paymentAttemptFindFirst).not.toHaveBeenCalled();
  });
});
