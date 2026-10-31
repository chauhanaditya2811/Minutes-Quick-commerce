import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../config/database.js";
import { isLateNight, readFeeSettings, type FeeTier } from "./fees.js";

// A stable ID ensures that every request uses the same store-settings record.
const STORE_SETTINGS_ID = "store-settings";

// Only return fields that the storefront and admin settings page need.
const settingsSelect = {
  storeOpen: true,
  deliveryFee: true,
  minimumOrder: true,
  supportEmail: true,
  storePhone: true,
  feeTiers: true,
  lateNightFeeEnabled: true,
  lateNightFee: true,
  lateNightStart: true,
  lateNightEnd: true,
} as const;

// Data accepted by the settings update operation after controller validation.
export interface UpdateStoreSettingsInput {
  storeOpen: boolean;
  minimumOrder: number;
  supportEmail: string | null;
  /** E.164 store phone; undefined leaves the saved number unchanged. */
  storePhone?: string | null;
  /** Convenience fee ranges; undefined leaves them unchanged. */
  feeTiers?: FeeTier[];
  /** Late-night fee rules; undefined leaves them unchanged. */
  lateNight?: { enabled: boolean; fee: number; start: string; end: string };
}

/**
 * Settings as the app sees them: the fee rules cleaned up, `deliveryFee` kept equal to the first
 * range's fee for older app versions, and whether the late-night fee applies right now.
 */
const present = (row: Awaited<ReturnType<typeof readRow>>, now = new Date()) => {
  const fees = readFeeSettings(row);
  return {
    storeOpen: row.storeOpen,
    minimumOrder: row.minimumOrder,
    supportEmail: row.supportEmail,
    storePhone: row.storePhone,
    deliveryFee: fees.feeTiers[0]?.fee ?? 0,
    ...fees,
    lateNightActive: fees.lateNightFeeEnabled && isLateNight(now, fees.lateNightStart, fees.lateNightEnd),
  };
};

const readRow = () =>
  prisma.setting.upsert({
    where: { id: STORE_SETTINGS_ID },
    create: {
      id: STORE_SETTINGS_ID,
      storeOpen: true,
      deliveryFee: 0,
      minimumOrder: 0,
      supportEmail: null,
      storePhone: null,
    },
    update: {},
    select: settingsSelect,
  });

// Retrieves the existing settings or creates the default configuration.
export const getOrCreateStoreSettings = async () => present(await readRow());

// Updates the existing settings or creates the record if it does not exist.
export const updateStoreSettings = async (
  data: UpdateStoreSettingsInput
) => {
  const { feeTiers, lateNight, ...rest } = data;
  const fields = {
    ...rest,
    ...(feeTiers ? { feeTiers: feeTiers as unknown as Prisma.InputJsonValue, deliveryFee: feeTiers[0]?.fee ?? 0 } : {}),
    ...(lateNight
      ? {
          lateNightFeeEnabled: lateNight.enabled,
          lateNightFee: lateNight.fee,
          lateNightStart: lateNight.start,
          lateNightEnd: lateNight.end,
        }
      : {}),
  };
  const row = await prisma.setting.upsert({
    where: { id: STORE_SETTINGS_ID },
    create: { id: STORE_SETTINGS_ID, ...fields },
    update: fields,
    select: settingsSelect,
  });
  return present(row);
};