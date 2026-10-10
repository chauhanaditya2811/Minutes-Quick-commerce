
import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import {
  CheckoutError,
  createOrder,
  validateCheckout,
} from "../services/order.service.js";

const getItems = (body: unknown): unknown =>
  typeof body === "object" &&
  body !== null &&
  !Array.isArray(body) &&
  "items" in body
    ? body.items
    : undefined;

const sendCheckoutError = (error: unknown, res: Response): void => {
  if (error instanceof CheckoutError) {
    res.status(error.statusCode).json({ message: error.message });
    return;
  }

  console.error("Order checkout request failed.", error);
  res.status(500).json({ message: "Unable to process checkout." });
};

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

    const items = getItems(req.body);

    if (!Array.isArray(items)) {
      res.status(400).json({
        message: "Provide an items array.",
      });
      return;
    }

    const checkout = await validateCheckout(
      req.firebaseUser.uid,
      items
    );

    res.status(200).json({
      message: "Checkout validated successfully.",
      checkout,
    });
  } catch (error) {
    sendCheckoutError(error, res);
  }
};

export const createOrderController = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  if (!req.firebaseUser) {
    res.status(401).json({ message: "Unauthorized." });
    return;
  }

  try {
    const items = getItems(req.body);
    if (!Array.isArray(items)) {
      res.status(400).json({ message: "Provide an items array." });
      return;
    }

    const order = await createOrder(req.firebaseUser.uid, req.body);
    res.status(201).json({
      message: "Order created. Payment is pending.",
      order,
    });
  } catch (error) {
    sendCheckoutError(error, res);
  }
};
