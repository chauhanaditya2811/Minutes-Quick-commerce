import { prisma } from "../config/database.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Only recent orders count, so rankings follow what students buy now. */
export const POPULARITY_WINDOW_DAYS = 30;
/** A product this new hasn't had a chance to sell yet, so it gets a place near the top. */
export const NEW_PRODUCT_DAYS = 7;
/** How many top sellers get the "Popular" tag, and how many orders each needs first. */
export const POPULAR_TAG_COUNT = 3;
export const POPULAR_TAG_MIN_ORDERS = 2;
/** Order counts are cached briefly per stock group; stock itself is always read live. */
const CACHE_MS = 5 * 60 * 1000;

const cache = new Map<string, { at: number; counts: Map<string, number> }>();

/** Tests and admin tools can drop cached counts so the next request recounts. */
export const clearPopularityCache = () => cache.clear();

/**
 * How many paid orders from the hostels of one stock group included each product in the last
 * 30 days. Hostels sharing a shelf share one ranking. Counts orders, not units, so one bulk
 * buyer can't outrank many separate customers.
 */
export const getRecentOrderCounts = async (stockGroupId: string, now = Date.now()) => {
  const hit = cache.get(stockGroupId);
  if (hit && now - hit.at < CACHE_MS) return hit.counts;

  // A cart can't hold the same product twice, so each order item is one order.
  const rows = await prisma.orderItem.groupBy({
    by: ["productId"],
    where: {
      order: {
        hostel: { stockGroupId },
        paymentStatus: "SUCCESS",
        orderStatus: { in: ["CONFIRMED", "DELIVERED"] },
        createdAt: { gte: new Date(now - POPULARITY_WINDOW_DAYS * DAY_MS) },
      },
    },
    _count: { _all: true },
  });

  const counts = new Map(rows.map((row) => [row.productId, row._count._all]));
  cache.set(stockGroupId, { at: now, counts });
  return counts;
};

interface Rankable {
  id: string;
  stock: number;
  createdAt: Date;
}

/**
 * Sorts a hostel's catalogue for customers:
 * 1. in-stock items before sold-out ones;
 * 2. most ordered in the last 30 days first;
 * 3. products added in the last 7 days rank as if they had as many orders as the item just
 *    below the top sellers, so they're seen without pushing best sellers down;
 * 4. ties: newest first.
 * The top few in-stock sellers are marked `popular`.
 */
export const rankByPopularity = <T extends Rankable>(products: T[], counts: Map<string, number>, now = Date.now()) => {
  const ordersOf = (p: T) => counts.get(p.id) ?? 0;
  const isNew = (p: T) => now - p.createdAt.getTime() < NEW_PRODUCT_DAYS * DAY_MS;

  const sellers = products
    .filter((p) => p.stock > 0 && !isNew(p))
    .map(ordersOf)
    .sort((a, b) => b - a);
  const newProductScore = sellers[POPULAR_TAG_COUNT] ?? 0;
  const score = (p: T) => (isNew(p) ? Math.max(ordersOf(p), newProductScore) : ordersOf(p));

  const ranked = [...products].sort(
    (a, b) =>
      Number(b.stock > 0) - Number(a.stock > 0) ||
      score(b) - score(a) ||
      b.createdAt.getTime() - a.createdAt.getTime()
  );

  const popular = new Set(
    ranked
      .filter((p) => p.stock > 0 && ordersOf(p) >= POPULAR_TAG_MIN_ORDERS)
      .sort((a, b) => ordersOf(b) - ordersOf(a))
      .slice(0, POPULAR_TAG_COUNT)
      .map((p) => p.id)
  );

  return ranked.map((p) => ({ ...p, popular: popular.has(p.id) }));
};
