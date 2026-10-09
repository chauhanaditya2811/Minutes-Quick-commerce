import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./auth.middleware.js";

// Allows access only to the Firebase account configured as the administrator.
export const requireAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.firebaseUser) {
    res.status(401).json({
      message: "Unauthorized",
    });
    return;
  }

  const adminEmail = process.env.ADMIN_EMAIL;

  if (!adminEmail) {
    res.status(500).json({
      message: "Admin email is not configured.",
    });
    return;
  }

  if (req.firebaseUser.email !== adminEmail) {
    res.status(403).json({
      message: "Forbidden: Admin access required.",
    });
    return;
  }

  next();
};