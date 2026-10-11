import { Router } from "express";
import {
  razorpayWebhookController,
} from "../controllers/razorpay-webhook.controller.js";

const router = Router();

// Razorpay authenticates this endpoint through its webhook signature.
router.post("/", razorpayWebhookController);

export default router;
