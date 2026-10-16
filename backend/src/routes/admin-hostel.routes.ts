import { Router } from "express";
import { createHostelController, deactivateHostelController, listAdminHostels } from "../controllers/hostel.controller.js";
import { requireAdmin } from "../middleware/admin.middleware.js";
import { authenticateFirebaseToken } from "../middleware/auth.middleware.js";

const router = Router();
router.use(authenticateFirebaseToken, requireAdmin);
router.get("/", listAdminHostels);
router.post("/", createHostelController);
router.delete("/:id", deactivateHostelController);
export default router;
