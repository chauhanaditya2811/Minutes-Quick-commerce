import type { FeeTier, StoreSettings } from '../types/product';
import { formatINR } from './format';

// Mirrors backend/src/services/fees.ts so the cart can estimate fees; the server's figures
// (shown at checkout before paying) are the ones charged.

const INDIA_OFFSET_MINUTES = 5 * 60 + 30;
const DAY_MINUTES = 24 * 60;

/** The fee rules from settings, falling back to the old flat fee if an older server sent none. */
export const feeTiersOf = (settings: StoreSettings): FeeTier[] =>
  settings.feeTiers?.length ? settings.feeTiers : [{ minSubtotal: 0, fee: settings.deliveryFee }];

/** Minutes after midnight for "HH:MM", or null. */
const minutesOf = (time: string | undefined) => {
  const match = time ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** The fee of the highest range the item total reaches. */
export const convenienceFeeFor = (subtotal: number, tiers: FeeTier[]) => {
  let fee = tiers[0]?.fee ?? 0;
  for (const tier of tiers) if (subtotal >= tier.minSubtotal) fee = tier.fee;
  return fee;
};

/** Whether `at` is inside the late-night window, in India time (start included, end excluded). */
export const isLateNight = (at: Date, start: string, end: string) => {
  const from = minutesOf(start);
  const to = minutesOf(end);
  if (from === null || to === null || from === to) return false;
  const now = (at.getUTCHours() * 60 + at.getUTCMinutes() + INDIA_OFFSET_MINUTES) % DAY_MINUTES;
  return from < to ? now >= from && now < to : now >= from || now < to;
};

/** Estimated fees for a basket right now. */
export const estimateFees = (subtotal: number, settings: StoreSettings, at = new Date()) => {
  const convenienceFee = convenienceFeeFor(subtotal, feeTiersOf(settings));
  const lateNightFee =
    settings.lateNightFeeEnabled && settings.lateNightStart && settings.lateNightEnd && isLateNight(at, settings.lateNightStart, settings.lateNightEnd)
      ? settings.lateNightFee ?? 0
      : 0;
  return { convenienceFee, lateNightFee };
};

/** "01:00" → "1 AM", "23:30" → "11:30 PM". */
export const formatClock = (time: string) => {
  const minutes = minutesOf(time);
  if (minutes === null) return time;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
};

/** One line per rule, e.g. ["₹10 under ₹60", "₹15 from ₹60", "₹20 from ₹100", "+₹5 from 1 AM to 6 AM"]. */
export const describeFeeRules = (settings: StoreSettings): string[] => {
  const tiers = feeTiersOf(settings);
  const lines =
    tiers.length === 1
      ? [`${formatINR(tiers[0]!.fee)} on every order`]
      : tiers.map((tier, i) =>
          i === 0 ? `${formatINR(tier.fee)} under ${formatINR(tiers[1]!.minSubtotal)}` : `${formatINR(tier.fee)} from ${formatINR(tier.minSubtotal)}`,
        );
  if (settings.lateNightFeeEnabled && settings.lateNightFee && settings.lateNightStart && settings.lateNightEnd) {
    lines.push(`+${formatINR(settings.lateNightFee)} late-night fee from ${formatClock(settings.lateNightStart)} to ${formatClock(settings.lateNightEnd)}`);
  }
  return lines;
};
