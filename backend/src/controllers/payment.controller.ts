
import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { CashfreeConfigError } from "../config/cashfree.js";
import { CheckoutError } from "../services/order.service.js";
import {
  createCashfreeOrderForCustomer,
  verifyCashfreePaymentForCustomer,
} from "../services/payment.service.js";

// Initialize payment for an existing order owned by the signed-in customer.
export const createCashfreeOrderController = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const firebaseUser = req.firebaseUser;

  // Never allow an unauthenticated customer to initialize payment.
  if (!firebaseUser) {
    res.status(401).json({ message: "Unauthorized." });
    return;
  }

  const orderId = req.params.orderId;

  if (typeof orderId !== "string" || !orderId.trim()) {
    res.status(400).json({ message: "A valid order ID is required." });
    return;
  }

  try {
    const payment = await createCashfreeOrderForCustomer(
      firebaseUser.uid,
      orderId
    );

    res.status(200).json({
      message: "Payment order initialized successfully.",
      payment,
    });
  } catch (error) {
    if (error instanceof CheckoutError) {
      res.status(error.statusCode).json({
        message: error.message,
      });
      return;
    }

    if (error instanceof CashfreeConfigError) {
      res.status(503).json({
        message: "Payment service is not configured.",
      });
      return;
    }

    // Log the internal error without exposing provider details to customers.
    console.error("Cashfree payment initialization failed.", error);

    res.status(500).json({
      message: "Unable to initialize payment. Please try again.",
    });
  }
};
export const verifyCashfreePaymentController = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const firebaseUser = req.firebaseUser;

  // Only the authenticated customer can verify their payment.
  if (!firebaseUser) {
    res.status(401).json({ message: "Unauthorized." });
    return;
  }

  const orderId = req.params.orderId;

  if (typeof orderId !== "string" || !orderId.trim()) {
    res.status(400).json({
      message: "A valid order ID is required.",
    });
    return;
  }

  try {
    const payment = await verifyCashfreePaymentForCustomer(
      firebaseUser.uid,
      orderId,
      req.body
    );

    res.status(200).json({
      message: "Payment verified successfully.",
      payment,
    });
  } catch (error) {
    if (error instanceof CheckoutError) {
      res.status(error.statusCode).json({
        message: error.message,
      });
      return;
    }

    if (error instanceof CashfreeConfigError) {
      res.status(503).json({
        message: "Payment service is not configured.",
      });
      return;
    }

    console.error("Cashfree payment verification failed.", error);

    res.status(500).json({
      message: "Unable to verify payment. Please try again.",
    });
  }
};
