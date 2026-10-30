import { Router } from "express";
import {
  activateHostelController,
  createHostelController,
  deactivateHostelController,
  listAdminHostels,
  permanentlyDeleteHostelController,
} from "../controllers/hostel.controller.js";
import { moveHostelToGroupController } from "../controllers/stock-group.controller.js";
import { requireAdmin } from "../middleware/admin.middleware.js";
import { authenticateFirebaseToken } from "../middleware/auth.middleware.js";

const router = Router();
router.use(authenticateFirebaseToken, requireAdmin);
router.get("/", listAdminHostels);
router.post("/", createHostelController);
router.patch("/:id/activate", activateHostelController);
router.patch("/:id/deactivate", deactivateHostelController);
router.delete("/:id/permanent", permanentlyDeleteHostelController);
// Move a hostel to another pool (shared stock), or to a new pool of its own.
router.patch("/:id/pool", moveHostelToGroupController);
export default router;
