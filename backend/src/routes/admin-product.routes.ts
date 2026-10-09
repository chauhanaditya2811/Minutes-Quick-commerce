
import { Router } from "express";
import {
  createProductController,
  updateProductController,
  deleteProductController,
} from "../controllers/product.controller.js";
import { uploadProductImageController } from "../controllers/image.controller.js";
import { authenticateFirebaseToken } from "../middleware/auth.middleware.js";
import { requireAdmin } from "../middleware/admin.middleware.js";
import upload from "../middleware/upload.middleware.js";

const router = Router();

// Admin-only product image upload.
router.post(
  "/products/images",
  authenticateFirebaseToken,
  requireAdmin,
  upload.single("image"),
  uploadProductImageController
);

// Admin-only product creation.
router.post(
  "/products",
  authenticateFirebaseToken,
  requireAdmin,
  createProductController
);

// Admin-only product update.
router.put(
  "/products/:id",
  authenticateFirebaseToken,
  requireAdmin,
  updateProductController
);

// Admin-only product soft deletion.
router.delete(
  "/products/:id",
  authenticateFirebaseToken,
  requireAdmin,
  deleteProductController
);

export default router;
