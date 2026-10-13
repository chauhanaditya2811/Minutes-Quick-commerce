import { Router } from "express";
import {
  getAdminOrdersController,
  updateAdminOrderStatusController,
} from "../controllers/admin-order.controller.js";
import { authenticateFirebaseToken } from "../middleware/auth.middleware.js";
import { requireAdmin } from "../middleware/admin.middleware.js";

const router = Router();

router.get(
  "/orders",
  authenticateFirebaseToken,
  requireAdmin,
  getAdminOrdersController
);

router.patch(
  "/orders/:orderId/status",
  authenticateFirebaseToken,
  requireAdmin,
  updateAdminOrderStatusController
);

export default router;
