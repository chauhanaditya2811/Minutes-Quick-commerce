import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../config/database.js";

// Reservations take units out of product_inventories.quantity when the customer starts paying,
// so `quantity` always means stock available to sell now. Every state change below is
// conditional on the current state, which makes each reservation consumed or restored exactly once.
// Stock belongs to a stock group (one shelf shared by one or more hostels): an order delivers to
// its hostel but takes units from that hostel's group, and each hold remembers the group so the
// units go back to the same shelf.

type Tx = Prisma.TransactionClient;

const DEFAULT_HOLD_MINUTES = 10;
const DEFAULT_GRACE_MINUTES = 5;

export class InventoryReservationError extends Error {
  constructor(message: string, readonly statusCode = 409) {
    super(message);
    this.name = "InventoryReservationError";
  }
}

export interface OrderStockItem {
  productId: string;
  quantity: number;
  productName?: string;
}

export interface OrderStockTarget {
  id: string;
  userId: string | null; // null for guest orders
  hostelId: string | null; // the delivery hostel; its stock group supplies the units
  items: OrderStockItem[];
}

const readMinutes = (name: string, fallback: number, min: number) => {
  const raw = process.env[name];
  const value = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be a whole number of minutes (at least ${min}).`);
  }
  return value;
};

/** Minutes a customer has to complete payment. */
export const getCheckoutHoldMinutes = () => readMinutes("CHECKOUT_HOLD_MINUTES", DEFAULT_HOLD_MINUTES, 1);

/** When a hold made now is released: the checkout hold plus a grace period for delayed confirmations. */
export const reservationExpiry = (now = new Date()) =>
  new Date(
    now.getTime() +
      (getCheckoutHoldMinutes() + readMinutes("RESERVATION_GRACE_MINUTES", DEFAULT_GRACE_MINUTES, 0)) * 60_000
  );

const byProductId = <T extends { productId: string }>(a: T, b: T) => a.productId.localeCompare(b.productId);

/** The stock group a hostel sells from. */
const stockGroupOf = async (tx: Tx, hostelId: string) => {
  const hostel = await tx.hostel.findUnique({ where: { id: hostelId }, select: { stockGroupId: true } });
  if (!hostel) throw new InventoryReservationError("This hostel is no longer available.", 409);
  return hostel.stockGroupId;
};

// Atomic conditional decrement: Postgres re-checks `quantity >= n` after taking the row lock,
// so two buyers can never both take the last unit.
const takeAvailable = (tx: Tx, productId: string, stockGroupId: string, quantity: number) =>
  tx.$executeRaw`
    UPDATE "product_inventories"
    SET "quantity" = "quantity" - ${quantity}, "updatedAt" = NOW()
    WHERE "productId" = ${productId}
      AND "stockGroupId" = ${stockGroupId}
      AND "isAvailable" = true
      AND "quantity" >= ${quantity}`;

// Takes up to `quantity` units regardless of availability, never below zero. Returns units taken.
const takeUpTo = async (tx: Tx, productId: string, stockGroupId: string, quantity: number) => {
  const rows = await tx.$queryRaw<{ before: number }[]>`
    WITH locked AS (
      SELECT "id", "quantity" FROM "product_inventories"
      WHERE "productId" = ${productId} AND "stockGroupId" = ${stockGroupId}
      FOR UPDATE
    )
    UPDATE "product_inventories" AS p
    SET "quantity" = GREATEST(p."quantity" - ${quantity}, 0), "updatedAt" = NOW()
    FROM locked
    WHERE p."id" = locked."id"
    RETURNING locked."quantity" AS "before"`;
  const before = rows[0]?.before ?? 0;
  return Math.min(Number(before), quantity);
};

/**
 * Holds stock for an order from its hostel's stock group. Throws (rolling back the caller's
 * transaction) if any item is short.
 */
export const reserveOrderStock = async (
  tx: Tx,
  input: { userId: string | null; orderId: string; hostelId: string; items: OrderStockItem[]; expiresAt: Date }
) => {
  const stockGroupId = await stockGroupOf(tx, input.hostelId);
  for (const item of [...input.items].sort(byProductId)) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new InventoryReservationError("Every quantity must be a positive whole number.", 400);
    }
    const taken = await takeAvailable(tx, item.productId, stockGroupId, item.quantity);
    if (taken !== 1) {
      throw new InventoryReservationError(
        `${item.productName ?? "An item in your cart"} is no longer available in the quantity you selected.`
      );
    }
  }

  await tx.inventoryReservation.createMany({
    data: input.items.map((item) => ({
      userId: input.userId,
      orderId: input.orderId,
      hostelId: input.hostelId,
      stockGroupId,
      productId: item.productId,
      quantity: item.quantity,
      expiresAt: input.expiresAt,
    })),
  });
};

type RestorableReservation = { id: string; productId: string; stockGroupId: string | null; quantity: number };
const restorable = { id: true, productId: true, stockGroupId: true, quantity: true } as const;

// Moves ACTIVE reservations to `status` and returns their units to stock, once each.
const restoreReservations = async (
  tx: Tx,
  reservations: RestorableReservation[],
  status: "RELEASED" | "EXPIRED",
  dueBy?: Date
) => {
  let restored = 0;
  for (const reservation of [...reservations].sort(byProductId)) {
    // For expiry, also re-check the deadline: a payment retry may have just extended the hold.
    const updated = await tx.inventoryReservation.updateMany({
      where: { id: reservation.id, status: "ACTIVE", ...(dueBy ? { expiresAt: { lte: dueBy } } : {}) },
      data: { status },
    });
    if (updated.count !== 1) continue;
    if (reservation.stockGroupId) {
      await tx.productInventory.updateMany({
        where: { productId: reservation.productId, stockGroupId: reservation.stockGroupId },
        data: { quantity: { increment: reservation.quantity } },
      });
    }
    restored += 1;
  }
  return restored;
};

/** Releases the live holds of one unpaid order, e.g. a guest checkout replaced by a newer one. */
export const releaseOrderReservations = async (tx: Tx, orderId: string) => {
  const reservations = await tx.inventoryReservation.findMany({
    where: { orderId, status: "ACTIVE", order: { orderStatus: "PENDING_PAYMENT" } },
    select: restorable,
  });
  return restoreReservations(tx, reservations, "RELEASED");
};

/** Releases a customer's holds on their other unpaid orders, e.g. after they abandoned a checkout. */
export const releaseUserPendingReservations = async (tx: Tx, userId: string, exceptOrderId?: string) => {
  const reservations = await tx.inventoryReservation.findMany({
    where: {
      userId,
      status: "ACTIVE",
      order: { orderStatus: "PENDING_PAYMENT" },
      ...(exceptOrderId ? { orderId: { not: exceptOrderId } } : {}),
    },
    select: restorable,
  });
  return restoreReservations(tx, reservations, "RELEASED");
};

/**
 * Called whenever payment starts (including retries): extends the order's live holds and re-takes
 * stock for any that already expired. Returns when the holds end, or null for pre-hostel orders.
 */
export const extendOrClaimReservations = async (tx: Tx, order: OrderStockTarget) => {
  if (!order.hostelId) return null;
  const expiresAt = reservationExpiry();

  await tx.inventoryReservation.updateMany({
    where: { orderId: order.id, status: "ACTIVE" },
    data: { expiresAt },
  });
  const active = await tx.inventoryReservation.findMany({
    where: { orderId: order.id, status: "ACTIVE" },
    select: { productId: true, quantity: true },
  });
  const held = new Map<string, number>();
  for (const reservation of active) {
    held.set(reservation.productId, (held.get(reservation.productId) ?? 0) + reservation.quantity);
  }

  const missing = order.items
    .map((item) => ({ ...item, quantity: item.quantity - (held.get(item.productId) ?? 0) }))
    .filter((item) => item.quantity > 0);
  if (missing.length > 0) {
    await reserveOrderStock(tx, { userId: order.userId, orderId: order.id, hostelId: order.hostelId, items: missing, expiresAt });
  }
  return expiresAt;
};

/**
 * Finalises stock for a paid order. Live holds become CONSUMED (their units were already taken).
 * Units whose hold expired or was released are taken again; if the stock group no longer has them,
 * as much as possible is taken and `shortfall` is reported. Call only once per order.
 */
export const consumeOrderReservations = async (tx: Tx, order: OrderStockTarget) => {
  if (!order.hostelId) return { shortfall: false };

  const active = await tx.inventoryReservation.findMany({
    where: { orderId: order.id, status: "ACTIVE" },
    select: { id: true, productId: true, quantity: true },
  });
  const covered = new Map<string, number>();
  for (const reservation of active) {
    const updated = await tx.inventoryReservation.updateMany({
      where: { id: reservation.id, status: "ACTIVE" },
      data: { status: "CONSUMED" },
    });
    if (updated.count === 1) {
      covered.set(reservation.productId, (covered.get(reservation.productId) ?? 0) + reservation.quantity);
    }
  }

  let shortfall = false;
  const now = new Date();
  let stockGroupId: string | null = null;
  for (const item of [...order.items].sort(byProductId)) {
    const needed = item.quantity - (covered.get(item.productId) ?? 0);
    if (needed <= 0) continue;
    stockGroupId ??= await stockGroupOf(tx, order.hostelId);
    const taken = await takeUpTo(tx, item.productId, stockGroupId, needed);
    if (taken < needed) shortfall = true;
    if (taken > 0) {
      // Audit record of stock taken after the original hold had lapsed.
      await tx.inventoryReservation.create({
        data: {
          userId: order.userId,
          orderId: order.id,
          hostelId: order.hostelId,
          stockGroupId,
          productId: item.productId,
          quantity: taken,
          status: "CONSUMED",
          expiresAt: now,
        },
      });
    }
  }
  return { shortfall };
};

/** Expires overdue holds and returns their units to stock. Safe to run concurrently. */
export const expireReservations = async () => {
  const now = new Date();
  const overdue = await prisma.inventoryReservation.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: now } },
    select: restorable,
    orderBy: { expiresAt: "asc" },
    take: 500,
  });
  if (overdue.length === 0) return { expiredCount: 0 };

  // restoreReservations re-checks status and deadline per row, skipping holds consumed or extended meanwhile.
  const expiredCount = await prisma.$transaction(async (tx) => {
    const stillDue = await tx.inventoryReservation.findMany({
      where: { id: { in: overdue.map((r) => r.id) }, status: "ACTIVE", expiresAt: { lte: now } },
      select: restorable,
    });
    return restoreReservations(tx, stillDue, "EXPIRED", now);
  });
  return { expiredCount };
};

/** Units currently held for unpaid orders, keyed "productId:stockGroupId". */
export const getActiveReservedQuantities = async (productIds?: string[]) => {
  const groups = await prisma.inventoryReservation.groupBy({
    by: ["productId", "stockGroupId"],
    where: { status: "ACTIVE", stockGroupId: { not: null }, ...(productIds ? { productId: { in: productIds } } : {}) },
    _sum: { quantity: true },
  });
  return new Map(groups.map((g) => [`${g.productId}:${g.stockGroupId}`, g._sum.quantity ?? 0]));
};
