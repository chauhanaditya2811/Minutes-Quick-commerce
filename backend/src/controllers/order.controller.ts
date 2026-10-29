
import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import {
  type CheckoutInput,
  CheckoutError,
  createOrder,
  getCustomerOrders,
  validateCheckout,
} from "../services/order.service.js";

const getCheckoutInput = (body: unknown): CheckoutInput =>
  typeof body === "object" && body !== null && !Array.isArray(body)
    ? {
        hostelId: "hostelId" in body ? body.hostelId : undefined,
        items: "items" in body ? body.items : undefined,
      }
    : { hostelId: undefined, items: undefined };

const sendCheckoutError = (error: unknown, res: Response): void => {
  if (error instanceof CheckoutError) {
    res.status(error.statusCode).json({ message: error.message });
    return;
  }

  console.error("Order checkout request failed.", error);
  res.status(500).json({ message: "Unable to process checkout." });
};

export const getMyOrdersController = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  if (!req.firebaseUser) {
    res.status(401).json({ message: "Unauthorized." });
    return;
  }

  try {
    const orders = await getCustomerOrders(req.firebaseUser.uid);
    res.status(200).json({ orders });
  } catch (error) {
    console.error("Order history request failed.", error);
    res.status(500).json({ message: "Unable to retrieve your orders." });
  }
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

    const input = getCheckoutInput(req.body);

    if (!Array.isArray(input.items)) {
      res.status(400).json({
        message: "Provide an items array.",
      });
      return;
    }

    const checkout = await validateCheckout(
      req.firebaseUser.uid,
      input
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
    const input = getCheckoutInput(req.body);
    if (!Array.isArray(input.items)) {
      res.status(400).json({ message: "Provide an items array." });
      return;
    }

    const order = await createOrder(req.firebaseUser.uid, input);
    res.status(201).json({
      message: "Order created. Payment is pending.",
      order,
    });
  } catch (error) {
    sendCheckoutError(error, res);
  }
};
