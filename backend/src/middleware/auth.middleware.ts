import { getAuth } from "firebase-admin/auth";
import type { NextFunction, Request, Response } from "express";
import firebaseAdmin from "../config/firebase.js";

export interface AuthenticatedRequest extends Request {
  firebaseUser?: {
    uid: string;
    email?: string;
    name?: string;
  };
}

export const authenticateFirebaseToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
      res.status(401).json({
        message: "Unauthorized: Firebase ID token is required.",
      });
      return;
    }

    const idToken = authorization.substring(7);

    if (!idToken) {
      res.status(401).json({
        message: "Unauthorized: Firebase ID token is required.",
      });
      return;
    }

    const decodedToken = await getAuth(firebaseAdmin).verifyIdToken(idToken);

   req.firebaseUser = {
  uid: decodedToken.uid,
  ...(decodedToken.email && { email: decodedToken.email }),
  ...(decodedToken.name && { name: decodedToken.name }),
};

    next();
  } catch (error) {
    console.error("Firebase authentication error:", error);

    res.status(401).json({
      message: "Unauthorized: Invalid or expired Firebase ID token.",
    });
  }
};