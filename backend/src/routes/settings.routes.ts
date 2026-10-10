
import { Router } from "express";
import {
  getPublicSettingsController,
} from "../controllers/settings.controller.js";

const router = Router();

// Public endpoint: the storefront needs these settings before checkout.
router.get("/", getPublicSettingsController);

export default router;
