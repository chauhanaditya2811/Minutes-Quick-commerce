import { Router } from "express";
import { listPublicPoolsController } from "../controllers/stock-group.controller.js";

// Public: where customers can shop. A pool is one shared stock serving one or more hostels.
const router = Router();
router.get("/", listPublicPoolsController);
export default router;
