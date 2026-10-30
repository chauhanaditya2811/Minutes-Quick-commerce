import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../config/database.js";

// Stock groups ("pools" in the admin) let several hostels sell from one shared stock, e.g.
// every boys' hostel. Every hostel belongs to exactly one pool; a hostel with its own shelf is
// a pool of one.

export class StockGroupError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "StockGroupError";
  }
}

const NAME_MAX = 80;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseName = (input: unknown) => {
  const name = typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > NAME_MAX) {
    throw new StockGroupError(`Enter a pool name (up to ${NAME_MAX} characters).`, 400);
  }
  return name;
};

const parseHostelIds = (input: unknown) => {
  if (!Array.isArray(input) || !input.every((id) => typeof id === "string" && id.trim())) {
    throw new StockGroupError("hostelIds must be a list of hostel IDs.", 400);
  }
  return [...new Set(input.map((id: string) => id.trim()))];
};

const withHostels = {
  hostels: { select: { id: true, name: true, isActive: true }, orderBy: { name: "asc" } },
} as const;

/** Every stock group with the hostels it serves, by name. */
export const listStockGroups = () =>
  prisma.stockGroup.findMany({ orderBy: { name: "asc" }, include: withHostels });

const requireHostels = async (tx: Prisma.TransactionClient, hostelIds: string[]) => {
  const hostels = await tx.hostel.findMany({ where: { id: { in: hostelIds } }, select: { id: true } });
  if (hostels.length !== hostelIds.length) throw new StockGroupError("One or more hostels no longer exist.", 400);
};

/**
 * Puts exactly `hostelIds` in the group. Hostels moved in leave their old groups; hostels left
 * out get a new group of their own (named after the hostel, starting with no stock), since a
 * hostel always needs somewhere to sell from.
 */
const setMembers = async (tx: Prisma.TransactionClient, groupId: string, hostelIds: string[]) => {
  await requireHostels(tx, hostelIds);
  await tx.hostel.updateMany({ where: { id: { in: hostelIds } }, data: { stockGroupId: groupId } });
  const removed = await tx.hostel.findMany({
    where: { stockGroupId: groupId, id: { notIn: hostelIds } },
    select: { id: true, name: true },
  });
  for (const hostel of removed) {
    const own = await tx.stockGroup.create({ data: { name: hostel.name } });
    await tx.hostel.update({ where: { id: hostel.id }, data: { stockGroupId: own.id } });
  }
};

/**
 * Copies the current stock a hostel sells from (quantity and availability of every product)
 * into a new pool, as a starting point for the pool's real counts. Units held for payments in
 * progress are not copied: they stay with the stock they were taken from.
 */
const copyStockFrom = async (tx: Prisma.TransactionClient, groupId: string, hostelId: string) => {
  const source = await tx.hostel.findUnique({ where: { id: hostelId }, select: { stockGroupId: true } });
  if (!source) throw new StockGroupError("The hostel to copy stock from no longer exists.", 400);
  const rows = await tx.productInventory.findMany({
    where: { stockGroupId: source.stockGroupId, product: { isDeleted: false } },
    select: { productId: true, quantity: true, isAvailable: true },
  });
  if (rows.length) {
    await tx.productInventory.createMany({ data: rows.map((row) => ({ ...row, stockGroupId: groupId })) });
  }
};

/**
 * Creates a pool, optionally moving hostels into it and starting its stock as a copy of one
 * hostel's current stock (`copyStockFromHostelId`).
 */
export const createStockGroup = async (input: unknown) => {
  const data = isRecord(input) ? input : {};
  const name = parseName(data.name);
  const hostelIds = data.hostelIds === undefined ? [] : parseHostelIds(data.hostelIds);
  const copyFrom =
    typeof data.copyStockFromHostelId === "string" && data.copyStockFromHostelId.trim() ? data.copyStockFromHostelId.trim() : null;
  return prisma.$transaction(async (tx) => {
    const group = await tx.stockGroup.create({ data: { name } });
    // Copy first: moving the source hostel into the new pool changes which stock it uses.
    if (copyFrom) await copyStockFrom(tx, group.id, copyFrom);
    if (hostelIds.length) await setMembers(tx, group.id, hostelIds);
    return tx.stockGroup.findUniqueOrThrow({ where: { id: group.id }, include: withHostels });
  });
};

/** Renames a group and/or sets exactly which hostels it serves. */
export const updateStockGroup = async (groupId: string, input: unknown) => {
  const data = isRecord(input) ? input : {};
  const name = data.name === undefined ? undefined : parseName(data.name);
  const hostelIds = data.hostelIds === undefined ? undefined : parseHostelIds(data.hostelIds);
  return prisma.$transaction(async (tx) => {
    const group = await tx.stockGroup.findUnique({ where: { id: groupId } });
    if (!group) throw new StockGroupError("Stock group not found.", 404);
    if (name !== undefined) await tx.stockGroup.update({ where: { id: groupId }, data: { name } });
    if (hostelIds !== undefined) await setMembers(tx, groupId, hostelIds);
    return tx.stockGroup.findUniqueOrThrow({ where: { id: groupId }, include: withHostels });
  });
};

/**
 * Moves one hostel into another pool, or (with no `stockGroupId`) into a new pool of its own,
 * named after it and starting empty. The pool it leaves keeps its stock; if no hostel uses it
 * any more it shows as unused and can be deleted.
 */
export const moveHostelToGroup = async (hostelId: string, input: unknown) => {
  const data = isRecord(input) ? input : {};
  const target = typeof data.stockGroupId === "string" && data.stockGroupId.trim() ? data.stockGroupId.trim() : null;
  return prisma.$transaction(async (tx) => {
    const hostel = await tx.hostel.findUnique({ where: { id: hostelId } });
    if (!hostel) throw new StockGroupError("Hostel not found.", 404);
    let groupId = target;
    if (groupId) {
      if (!(await tx.stockGroup.findUnique({ where: { id: groupId } }))) {
        throw new StockGroupError("That pool no longer exists.", 400);
      }
    } else {
      groupId = (await tx.stockGroup.create({ data: { name: hostel.name } })).id;
    }
    return tx.hostel.update({
      where: { id: hostelId },
      data: { stockGroupId: groupId },
      include: { stockGroup: { select: { id: true, name: true } } },
    });
  });
};

/**
 * Deletes a group that no longer serves any hostel, together with its stock counts. Refused
 * while it still serves hostels or holds units for payments in progress.
 */
export const deleteStockGroup = async (groupId: string) =>
  prisma.$transaction(async (tx) => {
    const group = await tx.stockGroup.findUnique({ where: { id: groupId }, include: { _count: { select: { hostels: true } } } });
    if (!group) throw new StockGroupError("Stock group not found.", 404);
    if (group._count.hostels > 0) {
      throw new StockGroupError("Move this pool's hostels to another pool before deleting it.", 409);
    }
    const held = await tx.inventoryReservation.count({ where: { stockGroupId: groupId, status: "ACTIVE" } });
    if (held > 0) {
      throw new StockGroupError("Stock in this pool is held for payments in progress. Try again in a few minutes.", 409);
    }
    await tx.stockGroup.delete({ where: { id: groupId } });
  });
