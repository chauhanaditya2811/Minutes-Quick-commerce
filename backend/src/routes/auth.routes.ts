import { Router } from "express";
import {
  authenticateFirebaseToken,
  type AuthenticatedRequest,
} from "../middleware/auth.middleware.js";

const router = Router();

router.get(
  "/test",
  authenticateFirebaseToken,
  (req: AuthenticatedRequest, res) => {
    res.status(200).json({
      authenticated: true,
      uid: req.firebaseUser!.uid,
    });
  }
);

export default router;