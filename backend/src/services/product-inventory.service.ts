import { prisma } from "../config/database.js";
import { getActiveReservedQuantities } from "./inventory.service.js";
import { getRecentOrderCounts, rankByPopularity } from "./product-popularity.service.js";

// Stock is counted per stock group: one shelf that serves one or more hostels. Customers shop
// at a hostel and see its group's stock; admins edit stock per group.

export const MAX_INVENTORY_QUANTITY = 2_147_483_647;
const MAX_INVENTORY_ENTRIES = 500;

export class InventoryServiceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "InventoryServiceError";
  }
}

export interface InventoryUpdateEntry {
  stockGroupId: string;
  isAvailable: boolean;
  quantity: number;
  // When present, the save only applies if the stored quantity still matches.
  expectedQuantity?: number;
}

export interface GroupInventoryUpdateEntry {
  productId: string;
  isAvailable: boolean;
  quantity: number;
  expectedQuantity?: number;
}

// One product/group row to save; `label` names it in conflict messages.
interface InventoryWrite {
  productId: string;
  stockGroupId: string;
  isAvailable: boolean;
  quantity: number;
  expectedQuantity?: number;
  label: string;
}

const catalogProductSelection = {
  id: true,
  name: true,
  imageUrl: true,
  description: true,
  price: true,
  unit: true,
  isDeleted: true,
  createdAt: true,
  updatedAt: true,
} as const;

const groupHostelSelection = {
  select: { id: true, name: true, isActive: true },
  orderBy: { name: "asc" },
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isQuantity = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAX_INVENTORY_QUANTITY;

const requireActiveHostel = async (hostelId: string) => {
  const hostel = await prisma.hostel.findUnique({ where: { id: hostelId } });
  if (!hostel || !hostel.isActive) {
    throw new InventoryServiceError("This hostel is not available.", 404);
  }
  return hostel;
};

// Returns the customer catalogue for one active hostel, most ordered first (see rankByPopularity).
// `stock` is the quantity in the hostel's stock group; `popular` marks the group's top sellers.
export const getHostelCatalog = async (hostelId: string) => {
  const { stockGroupId } = await requireActiveHostel(hostelId);

  const [rows, counts] = await Promise.all([
    prisma.productInventory.findMany({
      where: { stockGroupId, isAvailable: true, product: { isDeleted: false } },
      select: { quantity: true, product: { select: catalogProductSelection } },
    }),
    getRecentOrderCounts(stockGroupId),
  ]);

  return rankByPopularity(
    rows.map(({ quantity, product }) => ({ ...product, stock: quantity, hostelId })),
    counts
  );
};

/** A pool customers can shop at: it serves at least one active hostel. */
const requireLivePool = async (poolId: string) => {
  const live = await prisma.hostel.count({ where: { stockGroupId: poolId, isActive: true } });
  if (!live) throw new InventoryServiceError("This place is not available.", 404);
};

// Returns the customer catalogue for one pool (customers shop per pool), most ordered first.
export const getPoolCatalog = async (poolId: string) => {
  await requireLivePool(poolId);
  const [rows, counts] = await Promise.all([
    prisma.productInventory.findMany({
      where: { stockGroupId: poolId, isAvailable: true, product: { isDeleted: false } },
      select: { quantity: true, product: { select: catalogProductSelection } },
    }),
    getRecentOrderCounts(poolId),
  ]);
  return rankByPopularity(
    rows.map(({ quantity, product }) => ({ ...product, stock: quantity, poolId })),
    counts
  );
};

// Returns one product if it is enabled in the given pool.
export const getPoolProduct = async (poolId: string, productId: string) => {
  await requireLivePool(poolId);
  const row = await prisma.productInventory.findFirst({
    where: { stockGroupId: poolId, productId, isAvailable: true, product: { isDeleted: false } },
    select: { quantity: true, product: { select: catalogProductSelection } },
  });
  return row ? { ...row.product, stock: row.quantity, poolId } : null;
};

// Returns one product if it is enabled in the stock group of the given active hostel.
export const getHostelProduct = async (hostelId: string, productId: string) => {
  const { stockGroupId } = await requireActiveHostel(hostelId);

  const row = await prisma.productInventory.findFirst({
    where: { stockGroupId, productId, isAvailable: true, product: { isDeleted: false } },
    select: { quantity: true, product: { select: catalogProductSelection } },
  });

  return row ? { ...row.product, stock: row.quantity, hostelId } : null;
};

// Returns every active product with its per-group inventory for the admin table.
// `quantity` is stock available now; `reserved` is held for payments in progress.
export const getAdminProductsWithInventory = async () => {
  const [products, reserved] = await Promise.all([
    prisma.product.findMany({
      where: { isDeleted: false },
      orderBy: { createdAt: "desc" },
      include: {
        inventories: { select: { stockGroupId: true, quantity: true, isAvailable: true } },
      },
    }),
    getActiveReservedQuantities(),
  ]);

  return products.map(({ stock, inventories, ...product }) => ({
    ...product,
    legacyStock: stock,
    inventories: inventories.map((row) => ({
      ...row,
      reserved: reserved.get(`${product.id}:${row.stockGroupId}`) ?? 0,
    })),
  }));
};

const findActiveProduct = async (productId: string) => {
  const product = await prisma.product.findFirst({
    where: { id: productId, isDeleted: false },
    select: { id: true, name: true, stock: true },
  });
  if (!product) throw new InventoryServiceError("Product not found.", 404);
  return product;
};

/** A group is live for customers when at least one of its hostels is active. */
const groupSummary = (group: { id: string; name: string; hostels: { id: string; name: string; isActive: boolean }[] }) => ({
  stockGroupId: group.id,
  name: group.name,
  hostels: group.hostels,
  active: group.hostels.some((hostel) => hostel.isActive),
});

// Returns one row per stock group for a product.
export const getProductInventory = async (productId: string) => {
  const product = await findActiveProduct(productId);
  const [groups, rows, reserved] = await Promise.all([
    prisma.stockGroup.findMany({ orderBy: { name: "asc" }, include: { hostels: groupHostelSelection } }),
    prisma.productInventory.findMany({ where: { productId } }),
    getActiveReservedQuantities([productId]),
  ]);
  const rowsByGroup = new Map(rows.map((row) => [row.stockGroupId, row]));

  return {
    productId: product.id,
    productName: product.name,
    legacyStock: product.stock,
    groups: groups.map((group) => {
      const row = rowsByGroup.get(group.id);
      return {
        ...groupSummary(group),
        isAvailable: row?.isAvailable ?? false,
        quantity: row?.quantity ?? 0,
        reserved: reserved.get(`${product.id}:${group.id}`) ?? 0,
        exists: Boolean(row),
        updatedAt: row?.updatedAt ?? null,
      };
    }),
  };
};

// Validates an admin inventory payload keyed by stock group or by product, without touching the database.
const parseEntries = (input: unknown, key: "stockGroupId" | "productId", noun: string) => {
  if (!Array.isArray(input) || input.length === 0) {
    throw new InventoryServiceError(`Provide at least one ${noun} inventory entry.`, 400);
  }
  if (input.length > MAX_INVENTORY_ENTRIES) {
    throw new InventoryServiceError("Too many inventory entries.", 400);
  }

  const seen = new Set<string>();
  return input.map((entry) => {
    const rawId = isRecord(entry) ? entry[key] : undefined;
    if (!isRecord(entry) || typeof rawId !== "string" || !rawId.trim()) {
      throw new InventoryServiceError(`Every entry needs a ${noun} ID.`, 400);
    }
    const id = rawId.trim();
    if (seen.has(id)) {
      throw new InventoryServiceError(`Each ${noun} can only appear once.`, 400);
    }
    seen.add(id);
    if (typeof entry.isAvailable !== "boolean") {
      throw new InventoryServiceError("Availability must be true or false.", 400);
    }
    if (!isQuantity(entry.quantity)) {
      throw new InventoryServiceError(
        `Quantity must be a whole number between 0 and ${MAX_INVENTORY_QUANTITY}.`,
        400
      );
    }
    if (entry.expectedQuantity !== undefined && !isQuantity(entry.expectedQuantity)) {
      throw new InventoryServiceError("Expected quantity is invalid.", 400);
    }
    return {
      id,
      isAvailable: entry.isAvailable,
      quantity: entry.quantity,
      ...(entry.expectedQuantity === undefined ? {} : { expectedQuantity: entry.expectedQuantity as number }),
    };
  });
};

export const parseInventoryEntries = (input: unknown): InventoryUpdateEntry[] =>
  parseEntries(input, "stockGroupId", "stock group").map(({ id, ...entry }) => ({ stockGroupId: id, ...entry }));

export const parseGroupInventoryEntries = (input: unknown): GroupInventoryUpdateEntry[] =>
  parseEntries(input, "productId", "product").map(({ id, ...entry }) => ({ productId: id, ...entry }));

// Saving can race another admin creating the same product/group row at the same moment.
const saveOrReportConflict = async (writes: InventoryWrite[]) => {
  try {
    await saveInventoryWrites(writes);
  } catch (error) {
    if (isRecord(error) && error.code === "P2002") {
      throw new InventoryServiceError(
        "Stock was changed by someone else at the same time. Refresh and try again.",
        409
      );
    }
    throw error;
  }
};

// Saves several stock group rows for one product atomically.
export const updateProductInventory = async (productId: string, input: unknown) => {
  const entries = parseInventoryEntries(input);
  await findActiveProduct(productId);

  const groups = await prisma.stockGroup.findMany({
    where: { id: { in: entries.map(({ stockGroupId }) => stockGroupId) } },
    select: { id: true, name: true },
  });
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const unknown = entries.filter(({ stockGroupId }) => !groupNames.has(stockGroupId));
  if (unknown.length > 0) {
    throw new InventoryServiceError(
      `Unknown stock group ID(s): ${unknown.map(({ stockGroupId }) => stockGroupId).join(", ")}.`,
      400
    );
  }

  await saveOrReportConflict(
    entries.map((entry) => ({ ...entry, productId, label: groupNames.get(entry.stockGroupId) ?? entry.stockGroupId }))
  );

  return getProductInventory(productId);
};

const findStockGroup = async (stockGroupId: string) => {
  const group = await prisma.stockGroup.findUnique({
    where: { id: stockGroupId },
    include: { hostels: groupHostelSelection },
  });
  if (!group) throw new InventoryServiceError("Stock group not found.", 404);
  return group;
};

// Returns every non-deleted product with its stock in one group, with the hostels it serves.
// Products with no stock row yet are listed as unavailable with quantity 0 and `exists: false`.
export const getStockGroupInventory = async (stockGroupId: string) => {
  const group = await findStockGroup(stockGroupId);
  const products = await prisma.product.findMany({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true, imageUrl: true, unit: true, price: true },
  });
  const [rows, reserved] = await Promise.all([
    prisma.productInventory.findMany({ where: { stockGroupId } }),
    getActiveReservedQuantities(products.map((product) => product.id)),
  ]);
  const rowsByProduct = new Map(rows.map((row) => [row.productId, row]));

  return {
    ...groupSummary(group),
    products: products.map((product) => {
      const row = rowsByProduct.get(product.id);
      return {
        productId: product.id,
        name: product.name,
        imageUrl: product.imageUrl,
        unit: product.unit,
        price: product.price,
        isAvailable: row?.isAvailable ?? false,
        quantity: row?.quantity ?? 0,
        reserved: reserved.get(`${product.id}:${group.id}`) ?? 0,
        exists: Boolean(row),
        updatedAt: row?.updatedAt ?? null,
      };
    }),
  };
};

// Saves stock for several products in one group atomically. Only `quantity` and
// `isAvailable` change; reservations for payments in progress are never touched.
export const updateStockGroupInventory = async (stockGroupId: string, input: unknown) => {
  const entries = parseGroupInventoryEntries(input);
  await findStockGroup(stockGroupId);

  const products = await prisma.product.findMany({
    where: { id: { in: entries.map(({ productId }) => productId) }, isDeleted: false },
    select: { id: true, name: true },
  });
  const productNames = new Map(products.map((product) => [product.id, product.name]));
  const unknown = entries.filter(({ productId }) => !productNames.has(productId));
  if (unknown.length > 0) {
    throw new InventoryServiceError(
      `Unknown or deleted product ID(s): ${unknown.map(({ productId }) => productId).join(", ")}.`,
      400
    );
  }

  await saveOrReportConflict(
    entries.map((entry) => ({ ...entry, stockGroupId, label: productNames.get(entry.productId) ?? entry.productId }))
  );

  return getStockGroupInventory(stockGroupId);
};

// Writes rows in one transaction; any conflict rolls back every row.
const saveInventoryWrites = (writes: InventoryWrite[]) =>
  prisma.$transaction(async (tx) => {
    for (const entry of writes) {
      const { productId, stockGroupId } = entry;
      const data = { isAvailable: entry.isAvailable, quantity: entry.quantity };

      if (entry.expectedQuantity === undefined) {
        await tx.productInventory.upsert({
          where: { productId_stockGroupId: { productId, stockGroupId } },
          create: { productId, stockGroupId, ...data },
          update: data,
        });
        continue;
      }

      const updated = await tx.productInventory.updateMany({
        where: { productId, stockGroupId, quantity: entry.expectedQuantity },
        data,
      });
      if (updated.count === 1) continue;

      const existing = await tx.productInventory.findUnique({
        where: { productId_stockGroupId: { productId, stockGroupId } },
        select: { id: true },
      });
      // A missing row has an implicit quantity of 0.
      if (!existing && entry.expectedQuantity === 0) {
        await tx.productInventory.create({ data: { productId, stockGroupId, ...data } });
        continue;
      }

      throw new InventoryServiceError(
        `Stock for ${entry.label} changed since you opened it. Refresh and try again.`,
        409
      );
    }
  });
