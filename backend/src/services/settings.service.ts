import { prisma } from "../config/database.js";

// A stable ID ensures that every request uses the same store-settings record.
const STORE_SETTINGS_ID = "store-settings";

// Only return fields that the storefront and admin settings page need.
const settingsSelect = {
  storeOpen: true,
  deliveryFee: true,
  minimumOrder: true,
  supportEmail: true,
} as const;

// Data accepted by the settings update operation after controller validation.
export interface UpdateStoreSettingsInput {
  storeOpen: boolean;
  deliveryFee: number;
  minimumOrder: number;
  supportEmail: string | null;
}

// Retrieves the existing settings or creates the default configuration.
export const getOrCreateStoreSettings = async () => {
  return prisma.setting.upsert({
    where: {
      id: STORE_SETTINGS_ID,
    },
    create: {
      id: STORE_SETTINGS_ID,
      storeOpen: true,
      deliveryFee: 0,
      minimumOrder: 0,
      supportEmail: null,
    },
    update: {},
    select: settingsSelect,
  });
};

// Updates the existing settings or creates the record if it does not exist.
export const updateStoreSettings = async (
  data: UpdateStoreSettingsInput
) => {
  return prisma.setting.upsert({
    where: {
      id: STORE_SETTINGS_ID,
    },
    create: {
      id: STORE_SETTINGS_ID,
      ...data,
    },
    update: data,
    select: settingsSelect,
  });
};