import { prisma } from "../config/database.js";
import { getActiveReservedQuantities } from "./inventory.service.js";

export const MAX_INVENTORY_QUANTITY = 2_147_483_647;
const MAX_INVENTORY_ENTRIES = 500;

export class InventoryServiceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "InventoryServiceError";
  }
}

export interface InventoryUpdateEntry {
  hostelId: string;
  isAvailable: boolean;
  quantity: number;
  // When present, the save only applies if the stored quantity still matches.
  expectedQuantity?: number;
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

// Returns the customer catalogue for one active hostel. `stock` is that hostel's quantity.
export const getHostelCatalog = async (hostelId: string) => {
  await requireActiveHostel(hostelId);

  const rows = await prisma.productInventory.findMany({
    where: { hostelId, isAvailable: true, product: { isDeleted: false } },
    select: { quantity: true, product: { select: catalogProductSelection } },
    orderBy: { product: { createdAt: "desc" } },
  });

  return rows.map(({ quantity, product }) => ({ ...product, stock: quantity, hostelId }));
};

// Returns one product if it is enabled at the given active hostel.
export const getHostelProduct = async (hostelId: string, productId: string) => {
  await requireActiveHostel(hostelId);

  const row = await prisma.productInventory.findFirst({
    where: { hostelId, productId, isAvailable: true, product: { isDeleted: false } },
    select: { quantity: true, product: { select: catalogProductSelection } },
  });

  return row ? { ...row.product, stock: row.quantity, hostelId } : null;
};

// Returns every active product with its per-hostel inventory for the admin table.
// `quantity` is stock available now; `reserved` is held for payments in progress.
export const getAdminProductsWithInventory = async () => {
  const [products, reserved] = await Promise.all([
    prisma.product.findMany({
      where: { isDeleted: false },
      orderBy: { createdAt: "desc" },
      include: {
        inventories: { select: { hostelId: true, quantity: true, isAvailable: true } },
      },
    }),
    getActiveReservedQuantities(),
  ]);

  return products.map(({ stock, inventories, ...product }) => ({
    ...product,
    legacyStock: stock,
    inventories: inventories.map((row) => ({
      ...row,
      reserved: reserved.get(`${product.id}:${row.hostelId}`) ?? 0,
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

// Returns one row per hostel (including inactive ones) for a product.
export const getProductInventory = async (productId: string) => {
  const product = await findActiveProduct(productId);
  const [hostels, rows, reserved] = await Promise.all([
    prisma.hostel.findMany({ orderBy: { name: "asc" } }),
    prisma.productInventory.findMany({ where: { productId } }),
    getActiveReservedQuantities([productId]),
  ]);
  const rowsByHostel = new Map(rows.map((row) => [row.hostelId, row]));

  return {
    productId: product.id,
    productName: product.name,
    legacyStock: product.stock,
    hostels: hostels.map((hostel) => {
      const row = rowsByHostel.get(hostel.id);
      return {
        hostelId: hostel.id,
        hostelName: hostel.name,
        hostelActive: hostel.isActive,
        isAvailable: row?.isAvailable ?? false,
        quantity: row?.quantity ?? 0,
        reserved: reserved.get(`${product.id}:${hostel.id}`) ?? 0,
        exists: Boolean(row),
        updatedAt: row?.updatedAt ?? null,
      };
    }),
  };
};

// Validates an admin inventory payload without touching the database.
export const parseInventoryEntries = (input: unknown): InventoryUpdateEntry[] => {
  if (!Array.isArray(input) || input.length === 0) {
    throw new InventoryServiceError("Provide at least one hostel inventory entry.", 400);
  }
  if (input.length > MAX_INVENTORY_ENTRIES) {
    throw new InventoryServiceError("Too many inventory entries.", 400);
  }

  const seen = new Set<string>();
  return input.map((entry) => {
    if (!isRecord(entry) || typeof entry.hostelId !== "string" || !entry.hostelId.trim()) {
      throw new InventoryServiceError("Every entry needs a hostel ID.", 400);
    }
    const hostelId = entry.hostelId.trim();
    if (seen.has(hostelId)) {
      throw new InventoryServiceError("Each hostel can only appear once.", 400);
    }
    seen.add(hostelId);
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
      hostelId,
      isAvailable: entry.isAvailable,
      quantity: entry.quantity,
      ...(entry.expectedQuantity === undefined ? {} : { expectedQuantity: entry.expectedQuantity }),
    };
  });
};

// Saves several hostel inventory rows for one product atomically.
export const updateProductInventory = async (productId: string, input: unknown) => {
  const entries = parseInventoryEntries(input);
  await findActiveProduct(productId);

  const hostels = await prisma.hostel.findMany({
    where: { id: { in: entries.map(({ hostelId }) => hostelId) } },
    select: { id: true, name: true },
  });
  const hostelNames = new Map(hostels.map((hostel) => [hostel.id, hostel.name]));
  const unknown = entries.filter(({ hostelId }) => !hostelNames.has(hostelId));
  if (unknown.length > 0) {
    throw new InventoryServiceError(
      `Unknown hostel ID(s): ${unknown.map(({ hostelId }) => hostelId).join(", ")}.`,
      400
    );
  }

  try {
    await saveInventoryEntries(productId, entries, hostelNames);
  } catch (error) {
    // Another admin created the same product/hostel row at the same moment.
    if (isRecord(error) && error.code === "P2002") {
      throw new InventoryServiceError(
        "Stock was changed by someone else at the same time. Refresh and try again.",
        409
      );
    }
    throw error;
  }

  return getProductInventory(productId);
};

const saveInventoryEntries = (
  productId: string,
  entries: InventoryUpdateEntry[],
  hostelNames: Map<string, string>
) =>
  prisma.$transaction(async (tx) => {
    for (const entry of entries) {
      const data = { isAvailable: entry.isAvailable, quantity: entry.quantity };

      if (entry.expectedQuantity === undefined) {
        await tx.productInventory.upsert({
          where: { productId_hostelId: { productId, hostelId: entry.hostelId } },
          create: { productId, hostelId: entry.hostelId, ...data },
          update: data,
        });
        continue;
      }

      const updated = await tx.productInventory.updateMany({
        where: { productId, hostelId: entry.hostelId, quantity: entry.expectedQuantity },
        data,
      });
      if (updated.count === 1) continue;

      const existing = await tx.productInventory.findUnique({
        where: { productId_hostelId: { productId, hostelId: entry.hostelId } },
        select: { id: true },
      });
      // A missing row has an implicit quantity of 0.
      if (!existing && entry.expectedQuantity === 0) {
        await tx.productInventory.create({ data: { productId, hostelId: entry.hostelId, ...data } });
        continue;
      }

      throw new InventoryServiceError(
        `Stock for ${hostelNames.get(entry.hostelId)} changed since you opened it. Refresh and try again.`,
        409
      );
    }
  });
