import { Router } from "express";
import {
  activateHostelController,
  createHostelController,
  deactivateHostelController,
  listAdminHostels,
  permanentlyDeleteHostelController,
} from "../controllers/hostel.controller.js";
import {
  getHostelInventoryController,
  updateHostelInventoryController,
} from "../controllers/product.controller.js";
import { requireAdmin } from "../middleware/admin.middleware.js";
import { authenticateFirebaseToken } from "../middleware/auth.middleware.js";

const router = Router();
router.use(authenticateFirebaseToken, requireAdmin);
router.get("/", listAdminHostels);
router.post("/", createHostelController);
router.patch("/:id/activate", activateHostelController);
router.patch("/:id/deactivate", deactivateHostelController);
router.delete("/:id/permanent", permanentlyDeleteHostelController);
// Hostel-first stock management: every product's stock at one hostel.
router.get("/:id/inventory", getHostelInventoryController);
router.put("/:id/inventory", updateHostelInventoryController);
export default router;
