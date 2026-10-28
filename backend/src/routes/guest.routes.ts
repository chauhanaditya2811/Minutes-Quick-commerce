import { Router } from "express";
import {
  createGuestOrderController,
  createGuestPaymentController,
  getGuestOrderController,
  validateGuestCheckoutController,
  verifyGuestPaymentController,
} from "../controllers/guest-checkout.controller.js";
import { rateLimit } from "../middleware/rate-limit.middleware.js";

// Public guest-checkout routes: no Firebase sign-in. Each guest order is reachable only
// with the secret token that created it (X-Guest-Order-Token header). Limits are per IP and
// generous because many students share one hostel Wi-Fi address.
const TEN_MINUTES = 10 * 60_000;

const router = Router();

router.post("/checkout/validate", rateLimit({ windowMs: TEN_MINUTES, max: 120 }), validateGuestCheckoutController);
router.post("/orders", rateLimit({ windowMs: TEN_MINUTES, max: 60 }), createGuestOrderController);
router.get("/orders/:orderId", rateLimit({ windowMs: TEN_MINUTES, max: 240 }), getGuestOrderController);
router.post("/orders/:orderId/payment", rateLimit({ windowMs: TEN_MINUTES, max: 60 }), createGuestPaymentController);
router.post("/orders/:orderId/payment/verify", rateLimit({ windowMs: TEN_MINUTES, max: 120 }), verifyGuestPaymentController);

export default router;
