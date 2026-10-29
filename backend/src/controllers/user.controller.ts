import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import {
  getOrCreateUser,
  updateUserProfile,
} from "../services/user.service.js";
import { getHostelById } from "../services/hostel.service.js";

const userResponse = (user: Awaited<ReturnType<typeof getOrCreateUser>>) => ({
  id: user.id,
  firebaseUid: user.firebaseUid,
  email: user.email,
  name: user.name,
  profileImage: user.profileImage,
  phone: user.phone,
  hostelId: user.hostelId,
  hostel: user.hostel?.name ?? null,
  floor: user.floor,
  room: user.room,
});

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

    res.status(200).json(userResponse(user));
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

    const { name, phone, hostelId, floor, room } = req.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof hostelId !== "string" ||
      !hostelId.trim() ||
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

    const hostel = await getHostelById(hostelId.trim());
    if (!hostel || !hostel.isActive) {
      res.status(400).json({ message: "Select an active hostel." });
      return;
    }

    const user = await updateUserProfile(req.firebaseUser.uid, {
      name: name.trim(),
      phone,
      hostelId: hostel.id,
      floor,
      room: room.trim(),
    });

    res.status(200).json(userResponse(user));
  } catch (error) {
    console.error("Update current user error:", error);

    res.status(500).json({
      message: "Failed to update user profile.",
    });
  }
};
