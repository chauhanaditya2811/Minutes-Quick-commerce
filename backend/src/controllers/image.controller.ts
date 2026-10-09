
import type { Request, Response } from "express";
import { uploadProductImage } from "../services/image.service.js";
import { validateImageContent } from "../middleware/upload.middleware.js";

// Uploads a validated product image and returns its hosted URL.
export const uploadProductImageController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const file = req.file;

    if (!file) {
      res.status(400).json({
        message: "Please select an image to upload.",
      });
      return;
    }

    if (!validateImageContent(file.buffer, file.mimetype)) {
      res.status(400).json({
        message: "The uploaded file does not match its declared image type.",
      });
      return;
    }

    const result = await uploadProductImage(file);

    res.status(201).json({
      imageUrl: result.secure_url,
      publicId: result.public_id,
    });
  } catch (error) {
    console.error("Upload product image error:", error);

    res.status(500).json({
      message: "Failed to upload product image.",
    });
  }
};
