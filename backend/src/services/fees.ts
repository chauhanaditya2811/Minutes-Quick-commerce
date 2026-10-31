// Convenience fees: the store sells at MRP, so these fees are its income. The admin sets them in
// Store settings: a fee per order-value range, plus an optional late-night fee during set hours.

/** Orders from `minSubtotal` (item total, ₹) upwards pay `fee`, until the next range starts. */
export interface FeeTier {
  minSubtotal: number;
  fee: number;
}

export interface FeeSettings {
  feeTiers: FeeTier[];
  lateNightFeeEnabled: boolean;
  lateNightFee: number;
  /** "HH:MM", India time. The window may cross midnight (e.g. 23:00 to 05:00). */
  lateNightStart: string;
  lateNightEnd: string;
}

export class FeeRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeeRuleError";
  }
}

export const MAX_FEE_TIERS = 6;
export const MAX_FEE = 10_000;
const MAX_THRESHOLD = 1_000_000;
const DAY_MINUTES = 24 * 60;
const INDIA_OFFSET_MINUTES = 5 * 60 + 30;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const isWhole = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;

/** Validates the admin's price ranges: the first starts at ₹0, each later one starts higher. */
export const parseFeeTiers = (input: unknown): FeeTier[] => {
  if (!Array.isArray(input) || input.length === 0) {
    throw new FeeRuleError("Add at least one price range.");
  }
  if (input.length > MAX_FEE_TIERS) {
    throw new FeeRuleError(`Use at most ${MAX_FEE_TIERS} price ranges.`);
  }
  const tiers = input.map((tier) => {
    const row = typeof tier === "object" && tier !== null ? (tier as Record<string, unknown>) : {};
    if (!isWhole(row.minSubtotal, MAX_THRESHOLD)) {
      throw new FeeRuleError("Each price range must start at a whole number of rupees.");
    }
    if (!isWhole(row.fee, MAX_FEE)) {
      throw new FeeRuleError(`Each fee must be a whole number of rupees from 0 to ${MAX_FEE}.`);
    }
    return { minSubtotal: row.minSubtotal, fee: row.fee };
  });
  if (tiers[0]!.minSubtotal !== 0) {
    throw new FeeRuleError("The first price range must start at ₹0.");
  }
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i]!.minSubtotal <= tiers[i - 1]!.minSubtotal) {
      throw new FeeRuleError("Each price range must start above the one before it.");
    }
  }
  return tiers;
};

/** Minutes after midnight for "HH:MM", or null if it isn't a valid 24-hour time. */
export const parseTime = (value: unknown): number | null => {
  const match = typeof value === "string" ? TIME_PATTERN.exec(value) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** The fee of the highest range the item total reaches. */
export const convenienceFeeFor = (subtotal: number, tiers: FeeTier[]): number => {
  let fee = tiers[0]?.fee ?? 0;
  for (const tier of tiers) {
    if (subtotal >= tier.minSubtotal) fee = tier.fee;
  }
  return fee;
};

/** Whether `at` falls in the late-night window, in India time (start included, end excluded). */
export const isLateNight = (at: Date, start: string, end: string): boolean => {
  const from = parseTime(start);
  const to = parseTime(end);
  if (from === null || to === null || from === to) return false;
  const utcMinutes = at.getUTCHours() * 60 + at.getUTCMinutes();
  const now = (utcMinutes + INDIA_OFFSET_MINUTES) % DAY_MINUTES;
  return from < to ? now >= from && now < to : now >= from || now < to;
};

export const lateNightFeeAt = (settings: FeeSettings, at: Date): number =>
  settings.lateNightFeeEnabled && isLateNight(at, settings.lateNightStart, settings.lateNightEnd)
    ? settings.lateNightFee
    : 0;

/** Both fees for an order with this item total placed at `at`. */
export const feesFor = (subtotal: number, settings: FeeSettings, at: Date) => ({
  convenienceFee: convenienceFeeFor(subtotal, settings.feeTiers),
  lateNightFee: lateNightFeeAt(settings, at),
});

/**
 * Reads the fee rules from a settings row. Anything missing or damaged falls back safely: the
 * single old flat fee for all orders, and no late-night fee.
 */
export const readFeeSettings = (row: {
  deliveryFee?: number | null;
  feeTiers?: unknown;
  lateNightFeeEnabled?: boolean | null;
  lateNightFee?: number | null;
  lateNightStart?: string | null;
  lateNightEnd?: string | null;
}): FeeSettings => {
  let feeTiers: FeeTier[];
  try {
    feeTiers = parseFeeTiers(row.feeTiers);
  } catch {
    feeTiers = [{ minSubtotal: 0, fee: isWhole(row.deliveryFee, MAX_FEE) ? row.deliveryFee : 0 }];
  }
  const lateNightStart = parseTime(row.lateNightStart) === null ? "01:00" : (row.lateNightStart as string);
  const lateNightEnd = parseTime(row.lateNightEnd) === null ? "06:00" : (row.lateNightEnd as string);
  return {
    feeTiers,
    lateNightFeeEnabled: row.lateNightFeeEnabled === true && isWhole(row.lateNightFee, MAX_FEE),
    lateNightFee: isWhole(row.lateNightFee, MAX_FEE) ? row.lateNightFee : 0,
    lateNightStart,
    lateNightEnd,
  };
};
