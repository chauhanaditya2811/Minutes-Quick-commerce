import type { Request, Response } from "express";
import {
  getOrCreateStoreSettings,
  updateStoreSettings,
} from "../services/settings.service.js";
import { FeeRuleError, MAX_FEE, parseFeeTiers, parseTime } from "../services/fees.js";

const MAX_POSTGRES_INTEGER = 2_147_483_647;

/**
 * Normalises a store phone number to E.164 for a tel: link. Accepts Indian numbers written as
 * 98765 43210, 098765-43210, 91 98765 43210 or +91 98765 43210 (also landlines with STD code),
 * and any other number already in international +<country><number> form.
 */
export const normalizeStorePhone = (value: unknown): string | null | undefined => {
  if (typeof value !== "string") return undefined;
  const compact = value.replace(/[\s().-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  if (/^[1-9]\d{9}$/.test(compact)) return `+91${compact}`;
  if (/^0[1-9]\d{9}$/.test(compact)) return `+91${compact.slice(1)}`;
  if (/^91[1-9]\d{9}$/.test(compact)) return `+${compact}`;
  return undefined;
};

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

    const { storeOpen, minimumOrder, supportEmail, storePhone, feeTiers, lateNight } = req.body;

    // Require the core fields to avoid accidental partial updates. (A deliveryFee sent by older
    // admin pages is ignored: fees are set as price ranges.)
    if (
      typeof storeOpen !== "boolean" ||
      !Number.isSafeInteger(minimumOrder) ||
      minimumOrder < 0 ||
      minimumOrder > MAX_POSTGRES_INTEGER
    ) {
      res.status(400).json({
        message: "Provide a boolean storeOpen and a non-negative whole-number minimumOrder.",
      });
      return;
    }

    // Fee rules are optional so older admin pages that omit them never change them.
    let parsedTiers;
    let parsedLateNight;
    try {
      parsedTiers = feeTiers === undefined ? undefined : parseFeeTiers(feeTiers);
      if (lateNight !== undefined) {
        const night = typeof lateNight === "object" && lateNight !== null ? lateNight : {};
        if (typeof night.enabled !== "boolean") throw new FeeRuleError("Turn the late-night fee on or off.");
        if (!Number.isSafeInteger(night.fee) || night.fee < 0 || night.fee > MAX_FEE) {
          throw new FeeRuleError(`The late-night fee must be a whole number of rupees from 0 to ${MAX_FEE}.`);
        }
        if (parseTime(night.start) === null || parseTime(night.end) === null) {
          throw new FeeRuleError("Late-night hours must be times like 01:00 and 06:00.");
        }
        if (night.enabled && night.start === night.end) {
          throw new FeeRuleError("Late-night hours must start and end at different times.");
        }
        parsedLateNight = { enabled: night.enabled, fee: night.fee, start: night.start, end: night.end };
      }
    } catch (error) {
      if (error instanceof FeeRuleError) {
        res.status(400).json({ message: error.message });
        return;
      }
      throw error;
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

    // storePhone is optional so older admin pages that omit it never clear the saved number.
    let normalizedStorePhone: string | null | undefined;

    if (storePhone === undefined) {
      normalizedStorePhone = undefined;
    } else if (storePhone === null || storePhone === "") {
      normalizedStorePhone = null;
    } else {
      normalizedStorePhone = normalizeStorePhone(storePhone);
      if (!normalizedStorePhone) {
        res.status(400).json({
          message: "storePhone must be a valid phone number, e.g. 98765 43210 or +91 98765 43210.",
        });
        return;
      }
    }

    const settings = await updateStoreSettings({
      storeOpen,
      minimumOrder,
      supportEmail: normalizedSupportEmail,
      ...(normalizedStorePhone === undefined ? {} : { storePhone: normalizedStorePhone }),
      ...(parsedTiers ? { feeTiers: parsedTiers } : {}),
      ...(parsedLateNight ? { lateNight: parsedLateNight } : {}),
    });

    res.status(200).json(settings);
  } catch (error) {
    console.error("Unable to update admin store settings.", error);

    res.status(500).json({
      message: "Unable to update store settings.",
    });
  }
};