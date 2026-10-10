
import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import {
  validateCheckout,
  type CheckoutItemInput,
} from "../services/order.service.js";

// Validates the cart and returns a server-calculated checkout summary.
export const validateCheckoutController = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.firebaseUser) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    const { items } = req.body ?? {};

    if (!Array.isArray(items)) {
      res.status(400).json({
        message: "Provide an items array.",
      });
      return;
    }

    const checkout = await validateCheckout(
      req.firebaseUser.uid,
      items as CheckoutItemInput[]
    );

    res.status(200).json({
      message: "Checkout validated successfully.",
      checkout,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Checkout validation failed.";

    // Validation failures are client errors; unexpected database errors are not.
    const clientErrors = [
      "Your cart is empty.",
      "Your cart contains too many items.",
      "One or more cart items are invalid.",
      "Your cart contains a duplicate product.",
      "Please complete your customer profile before checkout.",
      "The store is currently closed.",
      "One or more products are no longer available.",
      "Your cart total is too large.",
      "The order total is too large.",
    ];

    const isClientError =
      clientErrors.includes(message) ||
      message.endsWith("is out of stock.") ||
      message.includes("unit(s) of") ||
      message.startsWith("Your order must be at least ₹");

    if (isClientError) {
      res.status(400).json({ message });
      return;
    }

    console.error("Checkout validation error:", error);

    res.status(500).json({
      message: "Unable to validate checkout.",
    });
  }
};
