import type { Request, Response } from "express";
import {
  getAdminOrders,
  markOrderDelivered,
  OrderManagementError,
} from "../services/order.service.js";

export const getAdminOrdersController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const orders = await getAdminOrders();
    res.status(200).json({ orders });
  } catch (error) {
    console.error("Unable to retrieve admin orders.", error);
    res.status(500).json({ message: "Unable to retrieve orders." });
  }
};

export const updateAdminOrderStatusController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { orderId } = req.params;
  if (typeof orderId !== "string" || !orderId.trim()) {
    res.status(400).json({ message: "A valid order ID is required." });
    return;
  }

  if (
    typeof req.body !== "object" ||
    req.body === null ||
    Array.isArray(req.body) ||
    req.body.status !== "DELIVERED"
  ) {
    res.status(400).json({
      message: 'Only the "DELIVERED" status transition is supported.',
    });
    return;
  }

  try {
    const order = await markOrderDelivered(orderId);
    res.status(200).json({
      message: "Order marked as delivered.",
      order,
    });
  } catch (error) {
    if (error instanceof OrderManagementError) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }

    console.error("Unable to update admin order status.", error);
    res.status(500).json({ message: "Unable to update order status." });
  }
};
