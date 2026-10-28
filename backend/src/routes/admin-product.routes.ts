
import { Router } from "express";
import {
  createProductController,
  updateProductController,
  deleteProductController,
  getAdminProductsController,
  getProductInventoryController,
  updateProductInventoryController,
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

// Admin-only product list with per-hostel inventory.
router.get(
  "/products",
  authenticateFirebaseToken,
  requireAdmin,
  getAdminProductsController
);

// Admin-only inventory of one product across every hostel.
router.get(
  "/products/:id/inventory",
  authenticateFirebaseToken,
  requireAdmin,
  getProductInventoryController
);

// Admin-only bulk save of one product's hostel inventory.
router.put(
  "/products/:id/inventory",
  authenticateFirebaseToken,
  requireAdmin,
  updateProductInventoryController
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
