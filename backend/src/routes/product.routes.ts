import { Router } from "express";
import {
  createProductController,
  getAllProducts,
  getSingleProduct,
  updateProductController,
  deleteProductController,
} from "../controllers/product.controller.js";
import { authenticateFirebaseToken } from "../middleware/auth.middleware.js";
import { requireAdmin } from "../middleware/admin.middleware.js";

const router = Router();

// Customer-facing product catalog.
router.get("/", getAllProducts);

// Customer-facing single product.
router.get("/:id", getSingleProduct);

// Admin-only product creation.
router.post(
  "/admin/products",
  authenticateFirebaseToken,
  requireAdmin,
  createProductController
);

// Admin-only product update.
router.put(
  "/admin/products/:id",
  authenticateFirebaseToken,
  requireAdmin,
  updateProductController
);

// Admin-only product soft deletion.
router.delete(
  "/admin/products/:id",
  authenticateFirebaseToken,
  requireAdmin,
  deleteProductController
);

export default router;