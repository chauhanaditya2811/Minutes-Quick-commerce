
import { prisma } from "../config/database.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  getRazorpayClient,
  getRazorpayKeyId,
  getRazorpayKeySecret,
} from "../config/razorpay.js";
import { CheckoutError } from "./order.service.js";

// Create or reuse a Razorpay order for an existing Minutes order.
export const createRazorpayOrderForCustomer = async (
  firebaseUid: string,
  orderId: string
) => {
  if (typeof orderId !== "string" || !orderId.trim()) {
    throw new CheckoutError("A valid order ID is required.", 400);
  }

  // Validate configuration before making database changes.
  const keyId = getRazorpayKeyId();
  const razorpay = getRazorpayClient();

  // Verify ownership and find the most recent payment attempt.
  const { order, attempt } = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: {
        id: orderId,
        user: { firebaseUid },
      },
      include: {
        paymentAttempts: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!order) {
      throw new CheckoutError("Order not found.", 404);
    }

    if (
      order.orderStatus !== "PENDING_PAYMENT" ||
      order.paymentStatus === "SUCCESS" ||
      order.paymentStatus === "REFUNDED"
    ) {
      throw new CheckoutError(
        "This order is not eligible for payment.",
        409
      );
    }

    // Minutes stores prices in rupees; Razorpay requires paise.
    const amountInPaise = order.total * 100;

    if (
      !Number.isSafeInteger(order.total) ||
      order.total < 1 ||
      !Number.isSafeInteger(amountInPaise)
    ) {
      throw new CheckoutError("The order amount is invalid.", 400);
    }

    const latestAttempt = order.paymentAttempts[0];

    // Reuse an active attempt when initializing payment again.
    if (
      ["PENDING", "CREATED"].includes(order.paymentStatus) &&
      latestAttempt &&
      latestAttempt.amount === order.total &&
      ["PENDING", "CREATED"].includes(latestAttempt.status)
    ) {
      return { order, attempt: latestAttempt };
    }

    // Create a new attempt after a failed or cancelled attempt.
    const attempt = await tx.paymentAttempt.create({
      data: {
        orderId: order.id,
        amount: order.total,
        status: "PENDING",
      },
    });

    // Allow a new payment attempt without confirming the order.
    if (["FAILED", "CANCELLED"].includes(order.paymentStatus)) {
      await tx.order.updateMany({
        where: {
          id: order.id,
          orderStatus: "PENDING_PAYMENT",
          paymentStatus: { in: ["FAILED", "CANCELLED"] },
        },
        data: { paymentStatus: "PENDING" },
      });
    }

    return { order, attempt };
  });

  // If our database already knows the gateway order ID, reuse it.
  if (attempt.razorpayOrderId) {
    return {
      orderId: order.id,
      paymentAttemptId: attempt.id,
      razorpayOrderId: attempt.razorpayOrderId,
      amount: order.total * 100,
      currency: "INR",
      keyId,
    };
  }

  const amountInPaise = order.total * 100;
  const receipt = `MIN-${attempt.id}`;

  // Find an existing Razorpay order using this attempt's stable receipt.
  // This helps recover when Razorpay created an order but our database
  // save failed or the original request lost its response.
  const findGatewayOrder = async () => {
    const collection = await razorpay.orders.all({
      receipt,
      count: 1,
    });

    const existing = collection.items?.find(
      (item) => item.receipt === receipt
    );

    if (!existing) {
      return null;
    }

    // Never reuse an order with a different amount or currency.
    if (
      existing.amount !== amountInPaise ||
      existing.currency !== "INR"
    ) {
      throw new CheckoutError(
        "The existing Razorpay order does not match this payment.",
        409
      );
    }

    return existing;
  };

  let gatewayOrder = await findGatewayOrder();

  if (!gatewayOrder) {
    try {
      // Only server-side order totals are used here.
      gatewayOrder = await razorpay.orders.create({
        amount: amountInPaise,
        currency: "INR",
        receipt,
        partial_payment: false,
        notes: {
          minutesOrderId: order.id,
          paymentAttemptId: attempt.id,
          orderNumber: order.orderNumber,
        },
      });
    } catch (createError) {
      // The gateway may have accepted the request even if its response
      // was lost. Search again before treating the operation as failed.
      let recoveredOrder;

      try {
        recoveredOrder = await findGatewayOrder();
      } catch (recoveryError) {
        if (recoveryError instanceof CheckoutError) {
          throw recoveryError;
        }

        // Preserve the original creation error if recovery also fails.
        throw createError;
      }

      if (!recoveredOrder) {
        throw createError;
      }

      gatewayOrder = recoveredOrder;
    }
  }

  // Store the gateway order and update payment state atomically.
  await prisma.$transaction(async (tx) => {
    const updatedOrder = await tx.order.updateMany({
      where: {
        id: order.id,
        orderStatus: "PENDING_PAYMENT",
        paymentStatus: { in: ["PENDING", "CREATED"] },
      },
      data: { paymentStatus: "CREATED" },
    });

    if (updatedOrder.count !== 1) {
      throw new CheckoutError(
        "The order changed while payment was being initialized.",
        409
      );
    }

    await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        razorpayOrderId: gatewayOrder.id,
        status: "CREATED",
      },
    });

    // Maintain the one-payment-record-per-order relationship.
    await tx.payment.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        razorpayOrderId: gatewayOrder.id,
        amount: order.total,
        status: "CREATED",
      },
      update: {
        razorpayOrderId: gatewayOrder.id,
        razorpayPaymentId: null,
        amount: order.total,
        status: "CREATED",
      },
    });
  });

  // Never send the secret key to the client.
  return {
    orderId: order.id,
    paymentAttemptId: attempt.id,
    razorpayOrderId: gatewayOrder.id,
    amount: gatewayOrder.amount,
    currency: gatewayOrder.currency,
    keyId,
  };
};

interface RazorpayVerificationInput {
  razorpay_order_id: unknown;
  razorpay_payment_id: unknown;
  razorpay_signature: unknown;
}

const isVerificationRecord = (
  value: unknown
): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value);

// Verify a captured Razorpay payment and confirm its Minutes order.
// The client-provided signature is never treated as payment status by itself.
export const verifyRazorpayPaymentForCustomer = async (
  firebaseUid: string,
  orderId: string,
  input: RazorpayVerificationInput
) => {
  if (
    !isVerificationRecord(input) ||
    typeof input.razorpay_order_id !== "string" ||
    !input.razorpay_order_id.trim() ||
    typeof input.razorpay_payment_id !== "string" ||
    !input.razorpay_payment_id.trim() ||
    typeof input.razorpay_signature !== "string" ||
    !/^[a-f0-9]{64}$/i.test(input.razorpay_signature)
  ) {
    throw new CheckoutError(
      "Payment verification details are invalid.",
      400
    );
  }

  const razorpayOrderId = input.razorpay_order_id;
  const razorpayPaymentId = input.razorpay_payment_id;
  const suppliedSignature = input.razorpay_signature;

  // Find the payment attempt by the internal order ID and gateway order ID.
  // Include the customer relationship so another customer's order cannot
  // be verified with this student's token.
  const attempt = await prisma.paymentAttempt.findFirst({
    where: {
      orderId,
      razorpayOrderId,
    },
    include: {
      order: {
        include: {
          user: {
            select: { firebaseUid: true },
          },
        },
      },
    },
  });

  if (
    !attempt ||
    !attempt.order ||
    attempt.order.user.firebaseUid !== firebaseUid
  ) {
    throw new CheckoutError("Payment attempt not found.", 404);
  }

  if (!attempt.razorpayOrderId) {
    throw new CheckoutError(
      "The payment attempt has no Razorpay order ID.",
      409
    );
  }

  // Always use the order ID stored on our server for HMAC generation.
  const keySecret = getRazorpayKeySecret();

  const expectedSignature = createHmac("sha256", keySecret)
    .update(`${attempt.razorpayOrderId}|${razorpayPaymentId}`)
    .digest();

  const receivedSignature = Buffer.from(suppliedSignature, "hex");

  // Check length before timingSafeEqual to avoid length errors.
  const signatureIsValid =
    receivedSignature.length === expectedSignature.length &&
    timingSafeEqual(expectedSignature, receivedSignature);

  if (!signatureIsValid) {
    throw new CheckoutError("Payment signature is invalid.", 400);
  }

  // Signature authenticity alone is not sufficient here. Fetch payment
  // details through our server-side SDK client before confirming the order.
  const razorpay = getRazorpayClient();
  const gatewayPayment = await razorpay.payments.fetch(
    razorpayPaymentId
  );

  const expectedAmountInPaise = attempt.amount * 100;

  if (
    !Number.isSafeInteger(expectedAmountInPaise) ||
    attempt.amount !== attempt.order.total ||
    gatewayPayment.id !== razorpayPaymentId ||
    gatewayPayment.order_id !== attempt.razorpayOrderId ||
    gatewayPayment.amount !== expectedAmountInPaise ||
    gatewayPayment.currency !== "INR" ||
    gatewayPayment.method !== "upi"
  ) {
    throw new CheckoutError(
      "The gateway payment does not match this order.",
      409
    );
  }

  // Do not confirm payments that are only authorized or have failed.
  if (
    gatewayPayment.status !== "captured" ||
    gatewayPayment.captured !== true
  ) {
    throw new CheckoutError(
      "The payment has not been captured. The order remains unconfirmed.",
      409
    );
  }

  // Atomically update the order, the exact payment attempt, and Payment.
  // Repeated verification of the same successful payment is idempotent.
  return prisma.$transaction(async (tx) => {
    const currentOrder = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        orderStatus: true,
        paymentStatus: true,
      },
    });

    const currentAttempt = await tx.paymentAttempt.findUnique({
      where: { id: attempt.id },
      select: {
        id: true,
        status: true,
        razorpayOrderId: true,
        razorpayPaymentId: true,
      },
    });

    if (!currentOrder || !currentAttempt) {
      throw new CheckoutError("Payment attempt not found.", 404);
    }

    // A retry of the same verified payment must not repeat the transition.
    if (
      currentOrder.paymentStatus === "SUCCESS" &&
      ["CONFIRMED", "DELIVERED"].includes(currentOrder.orderStatus) &&
      currentAttempt.status === "SUCCESS" &&
      currentAttempt.razorpayPaymentId === razorpayPaymentId
    ) {
      return {
        orderId: currentOrder.id,
        orderNumber: currentOrder.orderNumber,
        paymentAttemptId: attempt.id,
        razorpayOrderId: attempt.razorpayOrderId,
        razorpayPaymentId,
        paymentStatus: "SUCCESS" as const,
        orderStatus: currentOrder.orderStatus,
      };
    }

    if (
      currentOrder.orderStatus !== "PENDING_PAYMENT" ||
      !["PENDING", "CREATED", "FAILED"].includes(
        currentOrder.paymentStatus
      ) ||
      !["PENDING", "CREATED", "FAILED"].includes(
        currentAttempt.status
      ) ||
      currentAttempt.razorpayOrderId !== attempt.razorpayOrderId ||
      (
        currentAttempt.razorpayPaymentId !== null &&
        currentAttempt.razorpayPaymentId !== razorpayPaymentId
      )
    ) {
      throw new CheckoutError(
        "The order is not eligible for payment confirmation.",
        409
      );
    }

    const orderUpdate = await tx.order.updateMany({
      where: {
        id: orderId,
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

    if (orderUpdate.count !== 1) {
      throw new CheckoutError(
        "The order changed during payment verification.",
        409
      );
    }

    const attemptUpdate = await tx.paymentAttempt.updateMany({
      where: {
        id: attempt.id,
        status: {
          in: ["PENDING", "CREATED", "FAILED"],
        },
        razorpayOrderId: attempt.razorpayOrderId,
        OR: [
          { razorpayPaymentId: null },
          { razorpayPaymentId },
        ],
      },
      data: {
        status: "SUCCESS",
        razorpayPaymentId,
      },
    });

    if (attemptUpdate.count !== 1) {
      throw new CheckoutError(
        "The payment attempt changed during verification.",
        409
      );
    }

    await tx.payment.upsert({
      where: { orderId },
      create: {
        orderId,
        razorpayOrderId: razorpayOrderId,
        razorpayPaymentId,
        amount: attempt.amount,
        status: "SUCCESS",
      },
      update: {
        razorpayOrderId: razorpayOrderId,
        razorpayPaymentId,
        amount: attempt.amount,
        status: "SUCCESS",
      },
    });

    return {
      orderId: currentOrder.id,
      orderNumber: currentOrder.orderNumber,
      paymentAttemptId: attempt.id,
      razorpayOrderId: attempt.razorpayOrderId,
      razorpayPaymentId,
      paymentStatus: "SUCCESS" as const,
      orderStatus: "CONFIRMED" as const,
    };
  });
};
