import { Router } from "express";

import {
  createOrderController,
  getMyOrdersController,
  validateCheckoutController,
} from "../controllers/order.controller.js";

import {
  createRazorpayOrderController,
  verifyRazorpayPaymentController,
} from "../controllers/payment.controller.js";

import { authenticateFirebaseToken } from "../middleware/auth.middleware.js";

const router = Router();

// Customer order history must be registered before order-ID routes.
router.get("/my", authenticateFirebaseToken, getMyOrdersController);

// Create a Minutes order.
router.post("/", authenticateFirebaseToken, createOrderController);

// Validate the customer's cart.
router.post(
  "/validate",
  authenticateFirebaseToken,
  validateCheckoutController
);

// Initialize Razorpay payment for an existing order.
router.post(
  "/:orderId/payment",
  authenticateFirebaseToken,
  createRazorpayOrderController
);

// Verify the Razorpay payment response.
router.post(
  "/:orderId/payment/verify",
  authenticateFirebaseToken,
  verifyRazorpayPaymentController
);

export default router;