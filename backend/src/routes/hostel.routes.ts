import { Router } from "express";
import { listActiveHostels } from "../controllers/hostel.controller.js";

const router = Router();
router.get("/", listActiveHostels);
export default router;
