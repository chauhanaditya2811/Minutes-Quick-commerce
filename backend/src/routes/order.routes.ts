
import { Router } from "express";
import {
  createOrderController,
  validateCheckoutController,
} from "../controllers/order.controller.js";
import { authenticateFirebaseToken } from "../middleware/auth.middleware.js";

const router = Router();

router.post("/", authenticateFirebaseToken, createOrderController);

// Only authenticated customers can validate a checkout.
router.post(
  "/validate",
  authenticateFirebaseToken,
  validateCheckoutController
);

export default router;
