
import { Router } from "express";
import {
  getAdminSettingsController,
  updateAdminSettingsController,
} from "../controllers/settings.controller.js";
import { authenticateFirebaseToken } from "../middleware/auth.middleware.js";
import { requireAdmin } from "../middleware/admin.middleware.js";

const router = Router();

// Every endpoint in this router requires an authenticated admin.
router.use(authenticateFirebaseToken, requireAdmin);

// Retrieve the current settings.
router.get("/", getAdminSettingsController);

// Update store availability, delivery fee, minimum order and support email.
router.put("/", updateAdminSettingsController);

export default router;
