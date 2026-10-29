import { Router } from "express";

import {
  createOrderController,
  getMyOrderController,
  getMyOrdersController,
  validateCheckoutController,
} from "../controllers/order.controller.js";

import {
  createCashfreeOrderController,
  verifyCashfreePaymentController,
} from "../controllers/payment.controller.js";

import { authenticateFirebaseToken } from "../middleware/auth.middleware.js";

const router = Router();

// Customer order history must be registered before order-ID routes.
router.get("/my", authenticateFirebaseToken, getMyOrdersController);

// One of the signed-in customer's own orders (confirmation screen).
router.get("/:orderId", authenticateFirebaseToken, getMyOrderController);

// Create a Minutes order.
router.post("/", authenticateFirebaseToken, createOrderController);

// Validate the customer's cart.
router.post(
  "/validate",
  authenticateFirebaseToken,
  validateCheckoutController
);

// Initialize Cashfree payment for an existing order.
router.post(
  "/:orderId/payment",
  authenticateFirebaseToken,
  createCashfreeOrderController
);

// Verify the Cashfree payment response.
router.post(
  "/:orderId/payment/verify",
  authenticateFirebaseToken,
  verifyCashfreePaymentController
);

export default router;