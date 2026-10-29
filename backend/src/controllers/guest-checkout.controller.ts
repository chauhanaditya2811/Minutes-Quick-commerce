import type { Request, Response } from "express";
import { CashfreeConfigError } from "../config/cashfree.js";
import {
  CheckoutError,
  createGuestOrder,
  getGuestOrder,
  hashGuestToken,
  validateGuestCheckout,
} from "../services/order.service.js";
import {
  createCashfreeOrderForOwner,
  verifyCashfreePaymentForOwner,
} from "../services/payment.service.js";

/** Header carrying the guest's secret checkout token (kept out of URLs and logs). */
export const GUEST_TOKEN_HEADER = "x-guest-order-token";

const body = (req: Request): Record<string, unknown> =>
  typeof req.body === "object" && req.body !== null && !Array.isArray(req.body) ? req.body : {};

const sendGuestError = (error: unknown, res: Response, fallback: string): void => {
  if (error instanceof CheckoutError) {
    res.status(error.statusCode).json({ message: error.message });
    return;
  }
  if (error instanceof CashfreeConfigError) {
    res.status(503).json({ message: "Payment service is not configured." });
    return;
  }
  console.error(fallback, error);
  res.status(500).json({ message: fallback });
};

// The parts of a guest order the guest may see right after placing it. Never includes
// the owner reference, token hash or other customers' data.
const toGuestOrderResponse = (
  order: Awaited<ReturnType<typeof createGuestOrder>>
) => ({
  id: order.id,
  orderNumber: order.orderNumber,
  orderStatus: order.orderStatus,
  paymentStatus: order.paymentStatus,
  subtotal: order.subtotal,
  deliveryFee: order.deliveryFee,
  total: order.total,
  createdAt: order.createdAt,
  holdExpiresAt: order.holdExpiresAt,
  items: order.items.map((item) => ({
    productId: item.productId,
    productName: item.productName,
    price: item.price,
    unit: item.unit,
    quantity: item.quantity,
    subtotal: item.subtotal,
  })),
});

const orderIdParam = (req: Request): string | null => {
  const { orderId } = req.params;
  return typeof orderId === "string" && orderId.trim() ? orderId.trim() : null;
};

// Resolves the guest token from the header. A missing or malformed token is reported as
// "not found", the same as a wrong one, so the endpoint never reveals whether an order exists.
const guestOwner = (req: Request) => {
  const token = req.get(GUEST_TOKEN_HEADER);
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) {
    throw new CheckoutError("Order not found.", 404);
  }
  return { guestTokenHash: hashGuestToken(token) };
};

// Server-priced summary of a guest cart; stores nothing.
export const validateGuestCheckoutController = async (req: Request, res: Response): Promise<void> => {
  try {
    const { hostelId, items, customer } = body(req);
    const checkout = await validateGuestCheckout({ hostelId, items, customer });
    res.status(200).json({ message: "Checkout validated successfully.", checkout });
  } catch (error) {
    sendGuestError(error, res, "Unable to process checkout.");
  }
};

// Creates (or, for a repeated submission, returns) the guest's pending order and holds its stock.
export const createGuestOrderController = async (req: Request, res: Response): Promise<void> => {
  try {
    const { hostelId, items, customer, checkoutToken, replacesOrder } = body(req);
    const order = await createGuestOrder({ hostelId, items, customer, checkoutToken, replacesOrder });
    res.status(201).json({ message: "Order created. Payment is pending.", order: toGuestOrderResponse(order) });
  } catch (error) {
    sendGuestError(error, res, "Unable to process checkout.");
  }
};

// The guest's own order, for the confirmation page.
export const getGuestOrderController = async (req: Request, res: Response): Promise<void> => {
  const orderId = orderIdParam(req);
  if (!orderId) {
    res.status(404).json({ message: "Order not found." });
    return;
  }
  try {
    const order = await getGuestOrder(orderId, req.get(GUEST_TOKEN_HEADER));
    // serverTime lets the client correct for a wrong device clock in the delivery countdown.
    res.status(200).json({ order, serverTime: new Date().toISOString() });
  } catch (error) {
    sendGuestError(error, res, "Unable to retrieve this order.");
  }
};

// Starts (or resumes) Cashfree payment for the guest's own order.
export const createGuestPaymentController = async (req: Request, res: Response): Promise<void> => {
  const orderId = orderIdParam(req);
  if (!orderId) {
    res.status(404).json({ message: "Order not found." });
    return;
  }
  try {
    const payment = await createCashfreeOrderForOwner(guestOwner(req), orderId);
    res.status(200).json({ message: "Payment order initialized successfully.", payment });
  } catch (error) {
    sendGuestError(error, res, "Unable to initialize payment. Please try again.");
  }
};

// Verifies the payment with Cashfree on the server; the browser's word is never trusted.
export const verifyGuestPaymentController = async (req: Request, res: Response): Promise<void> => {
  const orderId = orderIdParam(req);
  if (!orderId) {
    res.status(404).json({ message: "Order not found." });
    return;
  }
  try {
    const { cashfree_order_id } = body(req);
    const payment = await verifyCashfreePaymentForOwner(guestOwner(req), orderId, { cashfree_order_id });
    res.status(200).json({ message: "Payment verified successfully.", payment });
  } catch (error) {
    sendGuestError(error, res, "Unable to verify payment.");
  }
};
