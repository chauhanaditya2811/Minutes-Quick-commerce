import { Router } from "express";
import { cashfreeWebhookController } from "../controllers/cashfree-webhook.controller.js";

const router = Router();
router.post("/", cashfreeWebhookController);
export default router;
