import { Router } from "express";
import { getCurrentUser, updateCurrentUser} from "../controllers/user.controller.js";
import { authenticateFirebaseToken } from "../middleware/auth.middleware.js";

const router = Router();

// Gets or creates the authenticated user's profile.
router.get(
  "/me",
  authenticateFirebaseToken,
  getCurrentUser
);

// Updates the authenticated user's profile.
router.put(
  "/me",
  authenticateFirebaseToken,
  updateCurrentUser
);

export default router;