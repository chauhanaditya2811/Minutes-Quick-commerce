import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRazorpayOrderForCustomer: vi.fn(),
  verifyRazorpayPaymentForCustomer: vi.fn(),
}));


// Mock the payment service so no real gateway or database is accessed.
vi.mock("../src/services/payment.service.js", () => ({
  createRazorpayOrderForCustomer: mocks.createRazorpayOrderForCustomer,
  verifyRazorpayPaymentForCustomer:
  mocks.verifyRazorpayPaymentForCustomer,
}));

// Keep the error class consistent with the controller's import.
vi.mock("../src/services/order.service.js", () => ({
  CheckoutError: class CheckoutError extends Error {
    constructor(
      message: string,
      readonly statusCode: number
    ) {
      super(message);
      this.name = "CheckoutError";
    }
  },
}));

vi.mock("../src/config/razorpay.js", () => ({
  RazorpayConfigError: class RazorpayConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "RazorpayConfigError";
    }
  },
}));

import type { Response } from "express";
import type { AuthenticatedRequest } from "../src/middleware/auth.middleware.js";
import { CheckoutError } from "../src/services/order.service.js";
import { RazorpayConfigError } from "../src/config/razorpay.js";
import { createRazorpayOrderController, verifyRazorpayPaymentController,} from "../src/controllers/payment.controller.js";

// Create a lightweight mock Express response.
const createMockResponse = () => {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };

  res.status.mockReturnValue(res);
  return res;
};

// Simulate a request from an authenticated student.
const createMockRequest = (
  orderId = "order-1",
  authenticated = true,
  body: unknown = undefined
) =>
  ({
    params: { orderId },
    body,
    firebaseUser: authenticated
      ? { uid: "firebase-user-1" }
      : undefined,
  }) as unknown as AuthenticatedRequest;

describe("Razorpay payment controller", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.createRazorpayOrderForCustomer.mockResolvedValue({
      orderId: "order-1",
      paymentAttemptId: "attempt-1",
      razorpayOrderId: "order_rzp_123",
      amount: 14000,
      currency: "INR",
      keyId: "rzp_test_public",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    const req = createMockRequest("order-1", false);
    const res = createMockResponse();

    await createRazorpayOrderController(
      req,
      res as unknown as Response
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      message: "Unauthorized.",
    });

    expect(
      mocks.createRazorpayOrderForCustomer
    ).not.toHaveBeenCalled();
  });

  it("rejects an empty order ID", async () => {
    const req = createMockRequest(" ");
    const res = createMockResponse();

    await createRazorpayOrderController(
      req,
      res as unknown as Response
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: "A valid order ID is required.",
    });

    expect(
      mocks.createRazorpayOrderForCustomer
    ).not.toHaveBeenCalled();
  });

  it("initializes payment for the authenticated customer", async () => {
    const req = createMockRequest("order-1");
    const res = createMockResponse();

    await createRazorpayOrderController(
      req,
      res as unknown as Response
    );

    expect(
      mocks.createRazorpayOrderForCustomer
    ).toHaveBeenCalledWith("firebase-user-1", "order-1");

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: "Payment order initialized successfully.",
      payment: {
        orderId: "order-1",
        paymentAttemptId: "attempt-1",
        razorpayOrderId: "order_rzp_123",
        amount: 14000,
        currency: "INR",
        keyId: "rzp_test_public",
      },
    });
  });

  it("returns the appropriate status for checkout errors", async () => {
    mocks.createRazorpayOrderForCustomer.mockRejectedValue(
      new CheckoutError("Order not found.", 404)
    );

    const req = createMockRequest("missing-order");
    const res = createMockResponse();

    await createRazorpayOrderController(
      req,
      res as unknown as Response
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      message: "Order not found.",
    });
  });

  it("returns 503 when the payment service is not configured", async () => {
    mocks.createRazorpayOrderForCustomer.mockRejectedValue(
      new RazorpayConfigError("Missing Razorpay credentials.")
    );

    const req = createMockRequest();
    const res = createMockResponse();

    await createRazorpayOrderController(
      req,
      res as unknown as Response
    );

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      message: "Payment service is not configured.",
    });
  });

  it("returns a generic error without exposing internal details", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    mocks.createRazorpayOrderForCustomer.mockRejectedValue(
      new Error("Internal gateway details")
    );

    const req = createMockRequest();
    const res = createMockResponse();

    await createRazorpayOrderController(
      req,
      res as unknown as Response
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      message: "Unable to initialize payment. Please try again.",
    });

    expect(res.json).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Internal gateway details",
      })
    );

    consoleSpy.mockRestore();
  });
});

describe("Razorpay payment verification controller", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.verifyRazorpayPaymentForCustomer.mockResolvedValue({
      orderId: "order-1",
      orderNumber: "MIN-TEST123",
      paymentAttemptId: "attempt-1",
      razorpayOrderId: "order_rzp_123",
      razorpayPaymentId: "pay_123",
      paymentStatus: "SUCCESS",
      orderStatus: "CONFIRMED",
    });
  });

  it("rejects unauthenticated verification requests", async () => {
    const req = createMockRequest(
      "order-1",
      false,
      {
        razorpay_order_id: "order_rzp_123",
        razorpay_payment_id: "pay_123",
        razorpay_signature: "a".repeat(64),
      }
    );
    const res = createMockResponse();

    await verifyRazorpayPaymentController(
      req,
      res as unknown as Response
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mocks.verifyRazorpayPaymentForCustomer).not.toHaveBeenCalled();
  });

  it("rejects a missing order ID", async () => {
    const req = createMockRequest(
      " ",
      true,
      {
        razorpay_order_id: "order_rzp_123",
        razorpay_payment_id: "pay_123",
        razorpay_signature: "a".repeat(64),
      }
    );
    const res = createMockResponse();

    await verifyRazorpayPaymentController(
      req,
      res as unknown as Response
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.verifyRazorpayPaymentForCustomer).not.toHaveBeenCalled();
  });

  it("calls the verification service and returns its result", async () => {
    const body = {
      razorpay_order_id: "order_rzp_123",
      razorpay_payment_id: "pay_123",
      razorpay_signature: "a".repeat(64),
    };

    const req = createMockRequest("order-1", true, body);
    const res = createMockResponse();

    await verifyRazorpayPaymentController(
      req,
      res as unknown as Response
    );

    expect(mocks.verifyRazorpayPaymentForCustomer).toHaveBeenCalledWith(
      "firebase-user-1",
      "order-1",
      body
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: "Payment verified successfully.",
      payment: {
        orderId: "order-1",
        orderNumber: "MIN-TEST123",
        paymentAttemptId: "attempt-1",
        razorpayOrderId: "order_rzp_123",
        razorpayPaymentId: "pay_123",
        paymentStatus: "SUCCESS",
        orderStatus: "CONFIRMED",
      },
    });
  });

  it("returns the status of a payment verification error", async () => {
    mocks.verifyRazorpayPaymentForCustomer.mockRejectedValue(
      new CheckoutError("Payment signature is invalid.", 400)
    );

    const req = createMockRequest();
    const res = createMockResponse();

    await verifyRazorpayPaymentController(
      req,
      res as unknown as Response
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: "Payment signature is invalid.",
    });
  });

  it("returns 503 when Razorpay configuration is missing", async () => {
    mocks.verifyRazorpayPaymentForCustomer.mockRejectedValue(
      new RazorpayConfigError("Missing payment credentials.")
    );

    const req = createMockRequest();
    const res = createMockResponse();

    await verifyRazorpayPaymentController(
      req,
      res as unknown as Response
    );

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      message: "Payment service is not configured.",
    });
  });

  it("does not expose internal errors to the customer", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    mocks.verifyRazorpayPaymentForCustomer.mockRejectedValue(
      new Error("Internal gateway response details")
    );

    const req = createMockRequest();
    const res = createMockResponse();

    await verifyRazorpayPaymentController(
      req,
      res as unknown as Response
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      message: "Unable to verify payment. Please try again.",
    });

    consoleSpy.mockRestore();
  });
});
