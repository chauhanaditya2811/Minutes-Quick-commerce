import type { Request, Response } from "express";
import {
  getOrCreateStoreSettings,
  updateStoreSettings,
} from "../services/settings.service.js";

const MAX_POSTGRES_INTEGER = 2_147_483_647;

// Public endpoint: returns the settings required by the storefront.
export const getPublicSettingsController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const settings = await getOrCreateStoreSettings();

    res.status(200).json(settings);
  } catch (error) {
    console.error("Unable to retrieve public store settings.", error);

    res.status(500).json({
      message: "Unable to retrieve store settings.",
    });
  }
};

// Admin endpoint: returns the current store settings.
export const getAdminSettingsController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const settings = await getOrCreateStoreSettings();

    res.status(200).json(settings);
  } catch (error) {
    console.error("Unable to retrieve admin store settings.", error);

    res.status(500).json({
      message: "Unable to retrieve store settings.",
    });
  }
};

// Admin endpoint: validates and saves store-wide settings.
export const updateAdminSettingsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (
      typeof req.body !== "object" ||
      req.body === null ||
      Array.isArray(req.body)
    ) {
      res.status(400).json({
        message: "A valid settings object is required.",
      });
      return;
    }

    const { storeOpen, deliveryFee, minimumOrder, supportEmail } = req.body;

    // Require all four fields to avoid accidental partial updates.
    if (
      typeof storeOpen !== "boolean" ||
      !Number.isSafeInteger(deliveryFee) ||
      deliveryFee < 0 ||
      deliveryFee > MAX_POSTGRES_INTEGER ||
      !Number.isSafeInteger(minimumOrder) ||
      minimumOrder < 0 ||
      minimumOrder > MAX_POSTGRES_INTEGER
    ) {
      res.status(400).json({
        message:
          "Provide a boolean storeOpen and non-negative whole-number deliveryFee and minimumOrder.",
      });
      return;
    }

    // Accept either a valid email address or null/empty string to clear it.
    let normalizedSupportEmail: string | null;

    if (supportEmail === null || supportEmail === "") {
      normalizedSupportEmail = null;
    } else if (
      typeof supportEmail === "string" &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail.trim())
    ) {
      normalizedSupportEmail = supportEmail.trim();
    } else {
      res.status(400).json({
        message: "supportEmail must be a valid email address or null.",
      });
      return;
    }

    const settings = await updateStoreSettings({
      storeOpen,
      deliveryFee,
      minimumOrder,
      supportEmail: normalizedSupportEmail,
    });

    res.status(200).json(settings);
  } catch (error) {
    console.error("Unable to update admin store settings.", error);

    res.status(500).json({
      message: "Unable to update store settings.",
    });
  }
};