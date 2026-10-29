/**
 * Decides whether a confirmed order should get the full-screen celebration. It plays once per
 * order on a device, and only right after confirmation: refreshing the page, reopening the
 * order later or checking an old order never replays it.
 */

const KEY = 'minutes.celebratedOrders.v1';
const MAX_REMEMBERED = 50;
/** Orders confirmed longer ago than this are shown without a celebration. */
const RECENT_MS = 3 * 60_000;

function readCelebrated(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Returns true (and records the order) if this freshly confirmed order has not been celebrated
 * on this device yet. Recording happens before the animation starts, so a refresh mid-animation
 * does not replay it.
 */
export function claimCelebration(orderId: string, confirmedAt: string | null, serverOffsetMs: number): boolean {
  if (!confirmedAt) return false;
  const confirmed = Date.parse(confirmedAt);
  if (Number.isNaN(confirmed)) return false;
  const age = Date.now() + serverOffsetMs - confirmed;
  if (age > RECENT_MS) return false;

  const celebrated = readCelebrated();
  if (celebrated.includes(orderId)) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify([orderId, ...celebrated].slice(0, MAX_REMEMBERED)));
  } catch {
    /* storage unavailable: celebrate this once; a refresh may replay it */
  }
  return true;
}
