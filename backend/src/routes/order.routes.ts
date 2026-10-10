
import { Router } from "express";
import { validateCheckoutController } from "../controllers/order.controller.js";
import { authenticateFirebaseToken } from "../middleware/auth.middleware.js";

const router = Router();

// Only authenticated customers can validate a checkout.
router.post(
  "/validate",
  authenticateFirebaseToken,
  validateCheckoutController
);

export default router;
