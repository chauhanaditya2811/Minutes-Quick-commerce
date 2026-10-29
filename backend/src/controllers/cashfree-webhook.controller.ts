import type { Request, Response } from "express";
import { CashfreeConfigError } from "../config/cashfree.js";
import { processCashfreeWebhook, CashfreeWebhookError } from "../services/cashfree-webhook.service.js";

export const cashfreeWebhookController = async (req: Request, res: Response): Promise<void> => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ message: "The raw webhook request body is required." });
    return;
  }
  try {
    const result = await processCashfreeWebhook(
      req.body,
      req.get("x-webhook-signature"),
      req.get("x-webhook-timestamp"),
      req.get("x-webhook-id"),
    );
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof CashfreeWebhookError) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }
    if (error instanceof CashfreeConfigError) {
      res.status(503).json({ message: "Webhook processing is not configured." });
      return;
    }
    console.error("Cashfree webhook processing failed.", error);
    res.status(500).json({ message: "Unable to process Cashfree webhook." });
  }
};
