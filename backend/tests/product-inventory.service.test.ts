import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hostelFindUnique: vi.fn(),
  hostelFindMany: vi.fn(),
  groupFindUnique: vi.fn(),
  groupFindMany: vi.fn(),
  productFindFirst: vi.fn(),
  productFindMany: vi.fn(),
  inventoryFindMany: vi.fn(),
  inventoryFindFirst: vi.fn(),
  inventoryFindUnique: vi.fn(),
  inventoryUpsert: vi.fn(),
  inventoryUpdateMany: vi.fn(),
  inventoryCreate: vi.fn(),
  transaction: vi.fn(),
  reservationGroupBy: vi.fn(),
  orderItemGroupBy: vi.fn(),
}));

const { productInventory } = vi.hoisted(() => ({
  productInventory: {
    findMany: mocks.inventoryFindMany,
    findFirst: mocks.inventoryFindFirst,
    findUnique: mocks.inventoryFindUnique,
    upsert: mocks.inventoryUpsert,
    updateMany: mocks.inventoryUpdateMany,
    create: mocks.inventoryCreate,
  },
}));

// Mock Prisma so these tests never write to the real database.
vi.mock("../src/config/database.js", () => ({
  prisma: {
    hostel: { findUnique: mocks.hostelFindUnique, findMany: mocks.hostelFindMany },
    stockGroup: { findUnique: mocks.groupFindUnique, findMany: mocks.groupFindMany },
    product: { findFirst: mocks.productFindFirst, findMany: mocks.productFindMany },
    productInventory,
    inventoryReservation: { groupBy: mocks.reservationGroupBy },
    orderItem: { groupBy: mocks.orderItemGroupBy },
    $transaction: mocks.transaction,
  },
}));

import {
  InventoryServiceError,
  getAdminProductsWithInventory,
  getHostelCatalog,
  getHostelProduct,
  getStockGroupInventory,
  getProductInventory,
  parseGroupInventoryEntries,
  parseInventoryEntries,
  updateStockGroupInventory,
  updateProductInventory,
} from "../src/services/product-inventory.service.js";
import { clearPopularityCache } from "../src/services/product-popularity.service.js";

const hostelA = { id: "hostel-a", name: "Hostel A", isActive: true, stockGroupId: "group-a" };
const hostelB = { id: "hostel-b", name: "Hostel B", isActive: false, stockGroupId: "group-b" };
const member = ({ id, name, isActive }: typeof hostelA) => ({ id, name, isActive });
const groupA = { id: "group-a", name: "Group A", hostels: [member(hostelA)] };
const groupB = { id: "group-b", name: "Group B", hostels: [member(hostelB)] };
const maggi = {
  id: "product-1",
  name: "Maggi",
  imageUrl: "https://images.example.test/maggi.jpg",
  description: null,
  price: 15,
  unit: "pack",
  isDeleted: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("hostel catalogue", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearPopularityCache();
    mocks.reservationGroupBy.mockResolvedValue([]);
    mocks.orderItemGroupBy.mockResolvedValue([]);
    mocks.hostelFindUnique.mockResolvedValue(hostelA);
  });

  it("returns only enabled, non-deleted products with the hostel quantity as stock", async () => {
    mocks.inventoryFindMany.mockResolvedValue([{ quantity: 30, product: maggi }]);

    await expect(getHostelCatalog("hostel-a")).resolves.toEqual([
      { ...maggi, stock: 30, hostelId: "hostel-a", popular: false },
    ]);
    expect(mocks.inventoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stockGroupId: "group-a", isAvailable: true, product: { isDeleted: false } },
      })
    );
  });

  it("keeps enabled zero-quantity products visible as out of stock", async () => {
    mocks.inventoryFindMany.mockResolvedValue([{ quantity: 0, product: maggi }]);

    const [product] = await getHostelCatalog("hostel-a");
    expect(product.stock).toBe(0);
  });

  it.each([
    ["unknown", null],
    ["inactive", { ...hostelA, isActive: false }],
  ])("rejects an %s hostel without reading inventory", async (_label, hostel) => {
    mocks.hostelFindUnique.mockResolvedValue(hostel);

    await expect(getHostelCatalog("hostel-a")).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.inventoryFindMany).not.toHaveBeenCalled();
  });

  it("returns null for a product that is not enabled at the hostel", async () => {
    mocks.inventoryFindFirst.mockResolvedValue(null);

    await expect(getHostelProduct("hostel-a", "product-1")).resolves.toBeNull();
    expect(mocks.inventoryFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          stockGroupId: "group-a",
          productId: "product-1",
          isAvailable: true,
          product: { isDeleted: false },
        },
      })
    );
  });
});

describe("admin inventory reads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.reservationGroupBy.mockResolvedValue([]);
  });

  it("lists products with inventories and exposes legacy stock separately", async () => {
    mocks.productFindMany.mockResolvedValue([
      { ...maggi, stock: 42, inventories: [{ stockGroupId: "group-a", quantity: 30, isAvailable: true }] },
    ]);

    mocks.reservationGroupBy.mockResolvedValue([
      { productId: "product-1", stockGroupId: "group-a", _sum: { quantity: 3 } },
    ]);

    const [product] = await getAdminProductsWithInventory();
    expect(product).not.toHaveProperty("stock");
    expect(product.legacyStock).toBe(42);
    expect(product.inventories).toEqual([
      { stockGroupId: "group-a", quantity: 30, isAvailable: true, reserved: 3 },
    ]);
  });

  it("returns every stock group, treating missing rows as unavailable with zero stock", async () => {
    mocks.productFindFirst.mockResolvedValue({ id: "product-1", name: "Maggi", stock: 42 });
    mocks.groupFindMany.mockResolvedValue([groupA, groupB]);
    mocks.inventoryFindMany.mockResolvedValue([
      { stockGroupId: "group-a", quantity: 30, isAvailable: true, updatedAt: new Date(0) },
    ]);

    const inventory = await getProductInventory("product-1");
    expect(inventory.legacyStock).toBe(42);
    expect(inventory.groups).toEqual([
      expect.objectContaining({ stockGroupId: "group-a", quantity: 30, isAvailable: true, exists: true, active: true }),
      expect.objectContaining({ stockGroupId: "group-b", quantity: 0, isAvailable: false, exists: false, active: false }),
    ]);
  });

  it("returns 404 for a deleted or missing product", async () => {
    mocks.productFindFirst.mockResolvedValue(null);

    await expect(getProductInventory("missing")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("inventory payload validation", () => {
  it.each([
    ["an empty list", []],
    ["a non-array", { stockGroupId: "group-a" }],
    ["a missing stock group ID", [{ isAvailable: true, quantity: 1 }]],
    ["duplicate stock groups", [
      { stockGroupId: "group-a", isAvailable: true, quantity: 1 },
      { stockGroupId: "group-a", isAvailable: false, quantity: 0 },
    ]],
    ["a non-boolean availability", [{ stockGroupId: "group-a", isAvailable: "yes", quantity: 1 }]],
    ["a negative quantity", [{ stockGroupId: "group-a", isAvailable: true, quantity: -1 }]],
    ["a fractional quantity", [{ stockGroupId: "group-a", isAvailable: true, quantity: 1.5 }]],
    ["a quantity above the database limit", [{ stockGroupId: "group-a", isAvailable: true, quantity: 2_147_483_648 }]],
    ["a string quantity", [{ stockGroupId: "group-a", isAvailable: true, quantity: "3" }]],
    ["an invalid expected quantity", [{ stockGroupId: "group-a", isAvailable: true, quantity: 3, expectedQuantity: -2 }]],
  ])("rejects %s", (_label, input) => {
    expect(() => parseInventoryEntries(input)).toThrow(InventoryServiceError);
  });

  it("normalises valid entries", () => {
    expect(
      parseInventoryEntries([{ stockGroupId: " group-a ", isAvailable: true, quantity: 3, expectedQuantity: 0 }])
    ).toEqual([{ stockGroupId: "group-a", isAvailable: true, quantity: 3, expectedQuantity: 0 }]);
  });
});

describe("inventory updates", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.reservationGroupBy.mockResolvedValue([]);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ productInventory })
    );
    mocks.productFindFirst.mockResolvedValue({ id: "product-1", name: "Maggi", stock: 0 });
    mocks.groupFindMany.mockImplementation(async (args?: { where?: unknown }) =>
      args?.where ? [{ id: "group-a", name: "Group A" }] : [groupA]
    );
    mocks.inventoryFindMany.mockResolvedValue([]);
    mocks.inventoryUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("upserts each entry inside one transaction", async () => {
    await updateProductInventory("product-1", [{ stockGroupId: "group-a", isAvailable: true, quantity: 30 }]);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.inventoryUpsert).toHaveBeenCalledWith({
      where: { productId_stockGroupId: { productId: "product-1", stockGroupId: "group-a" } },
      create: { productId: "product-1", stockGroupId: "group-a", isAvailable: true, quantity: 30 },
      update: { isAvailable: true, quantity: 30 },
    });
  });

  it("rejects unknown stock group IDs before writing", async () => {
    await expect(
      updateProductInventory("product-1", [{ stockGroupId: "ghost", isAvailable: true, quantity: 1 }])
    ).rejects.toMatchObject({ statusCode: 400, message: "Unknown stock group ID(s): ghost." });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects writes for deleted products", async () => {
    mocks.productFindFirst.mockResolvedValue(null);

    await expect(
      updateProductInventory("product-1", [{ stockGroupId: "group-a", isAvailable: true, quantity: 1 }])
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("applies a save only when the stored quantity still matches", async () => {
    await updateProductInventory("product-1", [
      { stockGroupId: "group-a", isAvailable: true, quantity: 25, expectedQuantity: 30 },
    ]);

    expect(mocks.inventoryUpdateMany).toHaveBeenCalledWith({
      where: { productId: "product-1", stockGroupId: "group-a", quantity: 30 },
      data: { isAvailable: true, quantity: 25 },
    });
    expect(mocks.inventoryUpsert).not.toHaveBeenCalled();
  });

  it("returns 409 when the stored quantity changed since the admin loaded it", async () => {
    mocks.inventoryUpdateMany.mockResolvedValue({ count: 0 });
    mocks.inventoryFindUnique.mockResolvedValue({ id: "row-1" });

    await expect(
      updateProductInventory("product-1", [
        { stockGroupId: "group-a", isAvailable: true, quantity: 25, expectedQuantity: 30 },
      ])
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("creates a missing row when the admin expected the implicit zero", async () => {
    mocks.inventoryUpdateMany.mockResolvedValue({ count: 0 });
    mocks.inventoryFindUnique.mockResolvedValue(null);

    await updateProductInventory("product-1", [
      { stockGroupId: "group-a", isAvailable: true, quantity: 12, expectedQuantity: 0 },
    ]);

    expect(mocks.inventoryCreate).toHaveBeenCalledWith({
      data: { productId: "product-1", stockGroupId: "group-a", isAvailable: true, quantity: 12 },
    });
  });

  it("maps a concurrent duplicate create to 409", async () => {
    mocks.transaction.mockRejectedValue(Object.assign(new Error("Unique constraint"), { code: "P2002" }));

    await expect(
      updateProductInventory("product-1", [{ stockGroupId: "group-a", isAvailable: true, quantity: 1 }])
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("stock management per stock group", () => {
  const water = { id: "product-2", name: "Water", imageUrl: "https://images.example.test/w.jpg", unit: "bottle", price: 10 };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.reservationGroupBy.mockResolvedValue([]);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ productInventory })
    );
    mocks.groupFindUnique.mockResolvedValue(groupA);
    mocks.productFindMany.mockImplementation(async (args?: { where?: { id?: unknown } }) =>
      args?.where?.id
        ? [{ id: "product-1", name: "Maggi" }, { id: "product-2", name: "Water" }]
        : [{ id: maggi.id, name: maggi.name, imageUrl: maggi.imageUrl, unit: maggi.unit, price: maggi.price }, water]
    );
    mocks.inventoryFindMany.mockResolvedValue([]);
    mocks.inventoryUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("lists every product for one group, with missing rows as unavailable and zero", async () => {
    mocks.inventoryFindMany.mockResolvedValue([
      { productId: "product-1", stockGroupId: "group-a", quantity: 0, isAvailable: true, updatedAt: new Date(0) },
    ]);
    mocks.reservationGroupBy.mockResolvedValue([
      { productId: "product-1", stockGroupId: "group-a", _sum: { quantity: 2 } },
      { productId: "product-1", stockGroupId: "group-b", _sum: { quantity: 9 } },
    ]);

    const inventory = await getStockGroupInventory("group-a");

    expect(inventory).toMatchObject({ stockGroupId: "group-a", name: "Group A", active: true, hostels: [member(hostelA)] });
    expect(mocks.inventoryFindMany).toHaveBeenCalledWith({ where: { stockGroupId: "group-a" } });
    expect(inventory.products).toEqual([
      expect.objectContaining({ productId: "product-1", isAvailable: true, quantity: 0, reserved: 2, exists: true }),
      expect.objectContaining({ productId: "product-2", isAvailable: false, quantity: 0, reserved: 0, exists: false }),
    ]);
  });

  it("returns groups whose hostels are all inactive so their stock can still be prepared", async () => {
    mocks.groupFindUnique.mockResolvedValue(groupB);
    await expect(getStockGroupInventory("group-b")).resolves.toMatchObject({ active: false });
  });

  it("returns 404 for an unknown stock group", async () => {
    mocks.groupFindUnique.mockResolvedValue(null);
    await expect(getStockGroupInventory("ghost")).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      updateStockGroupInventory("ghost", [{ productId: "product-1", isAvailable: true, quantity: 1 }])
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty list", []],
    ["a missing product ID", [{ isAvailable: true, quantity: 1 }]],
    ["duplicate products", [
      { productId: "product-1", isAvailable: true, quantity: 1 },
      { productId: "product-1", isAvailable: false, quantity: 0 },
    ]],
    ["a negative quantity", [{ productId: "product-1", isAvailable: true, quantity: -1 }]],
    ["a fractional quantity", [{ productId: "product-1", isAvailable: true, quantity: 2.5 }]],
    ["an unsafe quantity", [{ productId: "product-1", isAvailable: true, quantity: Number.MAX_SAFE_INTEGER + 1 }]],
    ["a non-boolean availability", [{ productId: "product-1", isAvailable: 1, quantity: 1 }]],
  ])("rejects %s", (_label, input) => {
    expect(() => parseGroupInventoryEntries(input)).toThrow(InventoryServiceError);
  });

  it("saves several products for one group in a single transaction", async () => {
    await updateStockGroupInventory("group-a", [
      { productId: "product-1", isAvailable: true, quantity: 20, expectedQuantity: 0 },
      { productId: "product-2", isAvailable: false, quantity: 0, expectedQuantity: 0 },
    ]);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.inventoryUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { productId: "product-1", stockGroupId: "group-a", quantity: 0 },
      data: { isAvailable: true, quantity: 20 },
    });
    expect(mocks.inventoryUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { productId: "product-2", stockGroupId: "group-a", quantity: 0 },
      data: { isAvailable: false, quantity: 0 },
    });
  });

  it("rejects unknown or deleted products before writing", async () => {
    mocks.productFindMany.mockResolvedValue([{ id: "product-1", name: "Maggi" }]);
    await expect(
      updateStockGroupInventory("group-a", [
        { productId: "product-1", isAvailable: true, quantity: 1 },
        { productId: "deleted-product", isAvailable: true, quantity: 1 },
      ])
    ).rejects.toMatchObject({ statusCode: 400, message: "Unknown or deleted product ID(s): deleted-product." });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("names the product whose stock changed since the admin opened the group", async () => {
    mocks.inventoryUpdateMany.mockResolvedValue({ count: 0 });
    mocks.inventoryFindUnique.mockResolvedValue({ id: "row-1" });

    await expect(
      updateStockGroupInventory("group-a", [{ productId: "product-2", isAvailable: true, quantity: 5, expectedQuantity: 3 }])
    ).rejects.toMatchObject({ statusCode: 409, message: "Stock for Water changed since you opened it. Refresh and try again." });
  });
});
