
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../config/database.js";
import { getRazorpayWebhookSecret } from "../config/razorpay.js";
import { isSupportedRazorpayPaymentMethod } from "../config/razorpay-payment-methods.js";

// Webhook errors carry an HTTP status for the controller.
export class RazorpayWebhookError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = "RazorpayWebhookError";
  }
}

type JsonRecord = Record<string, unknown>;

interface RazorpayWebhookPayment {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  method?: string;
  status: string;
  captured?: boolean;
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value);

const isWebhookEventUniqueConflict = (
  error: unknown
): boolean => {
  if (
    !isRecord(error) ||
    error.code !== "P2002" ||
    !isRecord(error.meta)
  ) {
    return false;
  }

  const target = error.meta.target;

  if (
    Array.isArray(target) &&
    target.some(
      (field: unknown) =>
        typeof field === "string" &&
        field.toLowerCase().includes("eventid")
    )
  ) {
    return true;
  }

  if (
    typeof target === "string" &&
    target.toLowerCase().includes("eventid")
  ) {
    return true;
  }

  const constraint = error.meta.constraint;

  return (
    typeof constraint === "string" &&
    constraint.toLowerCase().includes("razorpay_webhook_events")
  );
};

const duplicateEventResult = (eventName: string) => ({
  received: true,
  processed: false,
  event: eventName,
  reason: "duplicate_event",
});

// Verify the signature before parsing or trusting the webhook payload.
const verifyWebhookSignature = (
  rawBody: Buffer,
  signature: string | undefined
): void => {
  if (
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/i.test(signature)
  ) {
    throw new RazorpayWebhookError(
      "Missing or invalid Razorpay webhook signature.",
      400
    );
  }

  const secret = getRazorpayWebhookSecret();

  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest();

  const received = Buffer.from(signature, "hex");

  if (
    received.length !== expected.length ||
    !timingSafeEqual(expected, received)
  ) {
    throw new RazorpayWebhookError(
      "Razorpay webhook signature verification failed.",
      400
    );
  }
};

// Extract the payment entity only after the raw payload is authenticated.
const parseWebhookPayment = (
  payload: unknown,
  eventName: string
): RazorpayWebhookPayment => {
  if (!isRecord(payload) || !isRecord(payload.payment)) {
    throw new RazorpayWebhookError(
      "Invalid Razorpay webhook payload.",
      400
    );
  }

  const entity = payload.payment.entity;

  if (
    !isRecord(entity) ||
    typeof entity.id !== "string" ||
    !entity.id ||
    typeof entity.order_id !== "string" ||
    !entity.order_id ||
    typeof entity.amount !== "number" ||
    !Number.isSafeInteger(entity.amount) ||
    entity.amount <= 0 ||
    entity.currency !== "INR" ||
    typeof entity.status !== "string"
  ) {
    throw new RazorpayWebhookError(
      "Razorpay webhook payment details are invalid.",
      400
    );
  }

  if (
    eventName === "payment.captured" &&
    (
      entity.status !== "captured" ||
      entity.captured !== true ||
      !isSupportedRazorpayPaymentMethod(entity.method)
    )
  ) {
    console.warn("Razorpay captured webhook payment rejected", {
      capturedStatus: entity.status === "captured",
      capturedFlag: entity.captured === true,
      supportedMethod: isSupportedRazorpayPaymentMethod(entity.method),
    });
    throw new RazorpayWebhookError(
      "The captured payment is not a supported payment method.",
      409
    );
  }

  if (
    eventName === "payment.failed" &&
    entity.status !== "failed"
  ) {
    throw new RazorpayWebhookError(
      "The failed payment event has an unexpected status.",
      400
    );
  }

  return {
    id: entity.id,
    orderId: entity.order_id,
    amount: entity.amount,
    currency: entity.currency,
    ...(typeof entity.method === "string"
  ? { method: entity.method }
  : {}),
    status: entity.status,
    ...(typeof entity.captured === "boolean"
  ? { captured: entity.captured }
  : {}),
  };
};

// Reconcile a signed Razorpay webhook with the existing payment attempt.
export const processRazorpayWebhook = async (
  rawBody: Buffer,
  signature: string | undefined,
  eventId: string | undefined
) => {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    throw new RazorpayWebhookError(
      "The raw webhook request body is required.",
      400
    );
  }

  if (typeof eventId !== "string" || !eventId.trim()) {
    throw new RazorpayWebhookError(
      "The Razorpay webhook event ID is required.",
      400
    );
  }

  const normalizedEventId = eventId.trim();

  // Do not parse or re-serialize the body before checking its signature.
  verifyWebhookSignature(rawBody, signature);

  let envelope: unknown;

  try {
    envelope = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new RazorpayWebhookError(
      "The webhook body is not valid JSON.",
      400
    );
  }

  if (
    !isRecord(envelope) ||
    typeof envelope.event !== "string"
  ) {
    throw new RazorpayWebhookError(
      "Invalid Razorpay webhook event.",
      400
    );
  }

  const eventName = envelope.event;

  if (
    eventName !== "payment.captured" &&
    eventName !== "payment.failed"
  ) {
    try {
      return await prisma.$transaction(async (tx) => {
        const existingEvent = await tx.razorpayWebhookEvent.findUnique({
          where: {
            eventId: normalizedEventId,
          },
          select: {
            eventId: true,
          },
        });

        if (existingEvent) {
          return duplicateEventResult(eventName);
        }

        await tx.razorpayWebhookEvent.create({
          data: {
            eventId: normalizedEventId,
            eventType: eventName,
          },
        });

        return {
          received: true,
          processed: false,
          event: eventName,
          reason: "unsupported_event",
        };
      });
    } catch (error) {
      if (isWebhookEventUniqueConflict(error)) {
        return duplicateEventResult(eventName);
      }

      throw error;
    }
  }

  const payment = parseWebhookPayment(
    envelope.payload,
    eventName
  );

  // Locate the attempt using the Razorpay order ID, not client input.
  const attempt = await prisma.paymentAttempt.findFirst({
    where: {
      razorpayOrderId: payment.orderId,
    },
    include: {
      order: true,
    },
  });

  // A valid event can arrive while the payment initialization request
  // is still saving its gateway ID. Ask Razorpay to retry later.
  if (!attempt || !attempt.order || !attempt.razorpayOrderId) {
    throw new RazorpayWebhookError(
      "No matching payment attempt was found. Retry webhook processing.",
      503
    );
  }

  const order = attempt.order;
  const expectedAmountInPaise = attempt.amount * 100;

  // Check the signed gateway data against our stored order amounts.
  if (
    !Number.isSafeInteger(expectedAmountInPaise) ||
    attempt.amount !== order.total ||
    payment.amount !== expectedAmountInPaise ||
    payment.currency !== "INR"
  ) {
    throw new RazorpayWebhookError(
      "The webhook payment does not match the stored order amount.",
      409
    );
  }

  if (
    eventName === "payment.captured" &&
    !isSupportedRazorpayPaymentMethod(payment.method)
  ) {
    throw new RazorpayWebhookError(
      "Only supported captured payments can confirm an order.",
      409
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const currentOrder = await tx.order.findUnique({
        where: { id: order.id },
        include: { payment: true },
      });

      const currentAttempt = await tx.paymentAttempt.findUnique({
        where: { id: attempt.id },
      });

      if (!currentOrder || !currentAttempt) {
        throw new RazorpayWebhookError(
          "The order or payment attempt no longer exists.",
          503
        );
      }

      const existingEvent = await tx.razorpayWebhookEvent.findUnique({
        where: {
          eventId: normalizedEventId,
        },
        select: {
          eventId: true,
        },
      });

      if (existingEvent) {
        return duplicateEventResult(eventName);
      }

      await tx.razorpayWebhookEvent.create({
        data: {
          eventId: normalizedEventId,
          eventType: eventName,
        },
      });

      if (
        currentAttempt.razorpayOrderId !== payment.orderId
      ) {
        throw new RazorpayWebhookError(
          "The payment attempt no longer matches this Razorpay order.",
          409
        );
      }

      // A repeated successful event must not repeat the transition.
      if (
        eventName === "payment.captured" &&
        currentOrder.paymentStatus === "SUCCESS" &&
        ["CONFIRMED", "DELIVERED"].includes(
          currentOrder.orderStatus
        ) &&
        currentAttempt.status === "SUCCESS" &&
        currentAttempt.razorpayPaymentId === payment.id
      ) {
        return {
          received: true,
          processed: false,
          event: eventName,
          reason: "already_processed",
        };
      }

      // A late failure event must never downgrade an already paid order.
      if (
        eventName === "payment.failed" &&
        (
          currentOrder.paymentStatus === "SUCCESS" ||
          ["CONFIRMED", "DELIVERED"].includes(
            currentOrder.orderStatus
          )
        )
      ) {
        return {
          received: true,
          processed: false,
          event: eventName,
          reason: "order_already_paid",
        };
      }

      // Do not overwrite a different payment ID on the same attempt.
      if (
        currentAttempt.razorpayPaymentId !== null &&
        currentAttempt.razorpayPaymentId !== payment.id
      ) {
        throw new RazorpayWebhookError(
          "This payment attempt is already associated with another payment ID.",
          409
        );
      }

      // Ignore a delayed failure for an older attempt if another gateway
      // order is currently attached to the order's main Payment record.
      if (
        eventName === "payment.failed" &&
        currentOrder.payment?.razorpayOrderId !== payment.orderId
      ) {
        if (
          ["PENDING", "CREATED", "FAILED"].includes(
            currentAttempt.status
          )
        ) {
          await tx.paymentAttempt.updateMany({
            where: {
              id: currentAttempt.id,
              razorpayOrderId: payment.orderId,
              status: { in: ["PENDING", "CREATED", "FAILED"] },
              OR: [
                { razorpayPaymentId: null },
                { razorpayPaymentId: payment.id },
              ],
            },
            data: {
              status: "FAILED",
              razorpayPaymentId: payment.id,
            },
          });
        }

        return {
          received: true,
          processed: false,
          event: eventName,
          reason: "older_payment_attempt",
        };
      }

      if (
        currentOrder.orderStatus !== "PENDING_PAYMENT"
      ) {
        throw new RazorpayWebhookError(
          "The order is not eligible for this payment transition.",
          409
        );
      }

      if (eventName === "payment.captured") {
        if (
          !["PENDING", "CREATED", "FAILED"].includes(
            currentOrder.paymentStatus
          ) ||
          !["PENDING", "CREATED", "FAILED"].includes(
            currentAttempt.status
          )
        ) {
          throw new RazorpayWebhookError(
            "The order is not eligible for payment confirmation.",
            409
          );
        }

        const orderUpdate = await tx.order.updateMany({
          where: {
            id: currentOrder.id,
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
          throw new RazorpayWebhookError(
            "The order changed during webhook processing.",
            409
          );
        }

        const attemptUpdate = await tx.paymentAttempt.updateMany({
          where: {
            id: currentAttempt.id,
            razorpayOrderId: payment.orderId,
            status: { in: ["PENDING", "CREATED", "FAILED"] },
            OR: [
              { razorpayPaymentId: null },
              { razorpayPaymentId: payment.id },
            ],
          },
          data: {
            status: "SUCCESS",
            razorpayPaymentId: payment.id,
          },
        });

        if (attemptUpdate.count !== 1) {
          throw new RazorpayWebhookError(
            "The payment attempt changed during webhook processing.",
            409
          );
        }

        await tx.payment.upsert({
          where: { orderId: currentOrder.id },
          create: {
            orderId: currentOrder.id,
            razorpayOrderId: payment.orderId,
            razorpayPaymentId: payment.id,
            amount: currentAttempt.amount,
            status: "SUCCESS",
          },
          update: {
            razorpayOrderId: payment.orderId,
            razorpayPaymentId: payment.id,
            amount: currentAttempt.amount,
            status: "SUCCESS",
          },
        });

        return {
          received: true,
          processed: true,
          event: eventName,
          orderId: currentOrder.id,
          paymentStatus: "SUCCESS",
          orderStatus: "CONFIRMED",
        };
      }

      // payment.failed: leave the order unconfirmed and record the failure.
      if (
        !["PENDING", "CREATED", "FAILED"].includes(
          currentOrder.paymentStatus
        ) ||
        !["PENDING", "CREATED", "FAILED"].includes(
          currentAttempt.status
        )
      ) {
        throw new RazorpayWebhookError(
          "The order is not eligible for a failed-payment transition.",
          409
        );
      }

      const orderUpdate = await tx.order.updateMany({
        where: {
          id: currentOrder.id,
          orderStatus: "PENDING_PAYMENT",
          paymentStatus: {
            in: ["PENDING", "CREATED", "FAILED"],
          },
        },
        data: { paymentStatus: "FAILED" },
      });

      if (orderUpdate.count !== 1) {
        throw new RazorpayWebhookError(
          "The order changed during webhook processing.",
          409
        );
      }

      const attemptUpdate = await tx.paymentAttempt.updateMany({
        where: {
          id: currentAttempt.id,
          razorpayOrderId: payment.orderId,
          status: { in: ["PENDING", "CREATED", "FAILED"] },
          OR: [
            { razorpayPaymentId: null },
            { razorpayPaymentId: payment.id },
          ],
        },
        data: {
          status: "FAILED",
          razorpayPaymentId: payment.id,
        },
      });

      if (attemptUpdate.count !== 1) {
        throw new RazorpayWebhookError(
          "The payment attempt changed during webhook processing.",
          409
        );
      }

      await tx.payment.upsert({
        where: { orderId: currentOrder.id },
        create: {
          orderId: currentOrder.id,
          razorpayOrderId: payment.orderId,
          razorpayPaymentId: payment.id,
          amount: currentAttempt.amount,
          status: "FAILED",
        },
        update: {
          razorpayOrderId: payment.orderId,
          razorpayPaymentId: payment.id,
          amount: currentAttempt.amount,
          status: "FAILED",
        },
      });

      return {
        received: true,
        processed: true,
        event: eventName,
        orderId: currentOrder.id,
        paymentStatus: "FAILED",
        orderStatus: "PENDING_PAYMENT",
      };
    });
  } catch (error) {
    if (isWebhookEventUniqueConflict(error)) {
      return duplicateEventResult(eventName);
    }

    throw error;
  }
};
