import { Router } from "express";
import {
  createStockGroupController,
  deleteStockGroupController,
  listStockGroupsController,
  updateStockGroupController,
} from "../controllers/stock-group.controller.js";
import {
  getStockGroupInventoryController,
  updateStockGroupInventoryController,
} from "../controllers/product.controller.js";
import { requireAdmin } from "../middleware/admin.middleware.js";
import { authenticateFirebaseToken } from "../middleware/auth.middleware.js";

const router = Router();
router.use(authenticateFirebaseToken, requireAdmin);
router.get("/", listStockGroupsController);
router.post("/", createStockGroupController);
router.patch("/:id", updateStockGroupController);
router.delete("/:id", deleteStockGroupController);
// Stock management: every product's stock in one group (shared by all its hostels).
router.get("/:id/inventory", getStockGroupInventoryController);
router.put("/:id/inventory", updateStockGroupInventoryController);
export default router;
