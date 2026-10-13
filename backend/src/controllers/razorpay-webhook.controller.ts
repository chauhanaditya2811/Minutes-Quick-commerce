
import type { Request, Response } from "express";
import { RazorpayConfigError } from "../config/razorpay.js";
import {
  processRazorpayWebhook,
  RazorpayWebhookError,
} from "../services/razorpay-webhook.service.js";

// Accept signed Razorpay webhook events without Firebase authentication.
export const razorpayWebhookController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const rawBody: unknown = req.body;

  // The route must receive raw bytes, not parsed JSON.
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    res.status(400).json({
      message: "The raw webhook request body is required.",
    });
    return;
  }

  const signature = req.get("X-Razorpay-Signature");
  const eventId = req.get("X-Razorpay-Event-Id");

  try {
    const result = await processRazorpayWebhook(
      rawBody,
      signature,
      eventId
    );

    // A 2xx response acknowledges that the event was received.
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof RazorpayWebhookError) {
      res.status(error.statusCode).json({
        message: error.message,
      });
      return;
    }

    if (error instanceof RazorpayConfigError) {
      console.error("Razorpay webhook configuration is missing.");

      res.status(503).json({
        message: "Webhook processing is not configured.",
      });
      return;
    }

    console.error("Razorpay webhook processing failed.", error);

    res.status(500).json({
      message: "Unable to process Razorpay webhook.",
    });
  }
};
