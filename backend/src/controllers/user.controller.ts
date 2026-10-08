import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import {
  getOrCreateUser,
  updateUserProfile,
} from "../services/user.service.js";

export const getCurrentUser = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.firebaseUser) {
      res.status(401).json({
        message: "Unauthorized",
      });
      return;
    }

    const user = await getOrCreateUser(req.firebaseUser);

    res.status(200).json({
      id: user.id,
      firebaseUid: user.firebaseUid,
      email: user.email,
      name: user.name,
      profileImage: user.profileImage,
      phone: user.phone,
      hostel: user.hostel,
      floor: user.floor,
      room: user.room,
    });
  } catch (error) {
    console.error("Get current user error:", error);

    res.status(500).json({
      message: "Failed to get user profile.",
    });
  }
};
// Validates and updates the authenticated user's profile.
export const updateCurrentUser = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.firebaseUser) {
      res.status(401).json({
        message: "Unauthorized",
      });
      return;
    }

    const { name, phone, hostel, floor, room } = req.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof hostel !== "string" ||
      !hostel.trim() ||
      typeof room !== "string" ||
      !room.trim()
    ) {
      res.status(400).json({
        message: "Name, hostel, and room are required.",
      });
      return;
    }

    if (
      typeof phone !== "string" ||
      !/^[6-9]\d{9}$/.test(phone)
    ) {
      res.status(400).json({
        message: "Phone must be exactly 10 digits and start with 6-9.",
      });
      return;
    }

    if (!Number.isInteger(floor) || floor < 0) {
      res.status(400).json({
        message: "Floor must be an integer greater than or equal to 0.",
      });
      return;
    }

    const user = await updateUserProfile(req.firebaseUser.uid, {
      name: name.trim(),
      phone,
      hostel: hostel.trim(),
      floor,
      room: room.trim(),
    });

    res.status(200).json({
      id: user.id,
      firebaseUid: user.firebaseUid,
      email: user.email,
      name: user.name,
      profileImage: user.profileImage,
      phone: user.phone,
      hostel: user.hostel,
      floor: user.floor,
      room: user.room,
    });
  } catch (error) {
    console.error("Update current user error:", error);

    res.status(500).json({
      message: "Failed to update user profile.",
    });
  }
};