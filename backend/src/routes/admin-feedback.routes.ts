import { Router } from "express";
import {
  deleteProductRequestController,
  getAdminFeedbackController,
  getAdminProductRequestsController,
  updateFeedbackStatusController,
  updateProductRequestStatusController,
} from "../controllers/feedback.controller.js";
import { authenticateFirebaseToken } from "../middleware/auth.middleware.js";
import { requireAdmin } from "../middleware/admin.middleware.js";

const router = Router();

// Every endpoint in this router requires an authenticated admin.
router.use(authenticateFirebaseToken, requireAdmin);

router.get("/product-requests", getAdminProductRequestsController);
router.patch("/product-requests/:requestId", updateProductRequestStatusController);
router.delete("/product-requests/:requestId", deleteProductRequestController);
router.get("/messages", getAdminFeedbackController);
router.patch("/messages/:feedbackId", updateFeedbackStatusController);

export default router;
