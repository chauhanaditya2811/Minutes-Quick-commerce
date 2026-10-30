import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/config/database.js";
import { createOrder } from "../../src/services/order.service.js";
import { expireReservations } from "../../src/services/inventory.service.js";
import { getStockGroupInventory, updateStockGroupInventory } from "../../src/services/product-inventory.service.js";
import { createInventoryFixture } from "./fixtures.js";

// Hostel-first stock saves against the real minutes_test database.
describe("hostel-first stock management (minutes_test)", () => {
  let fx: Awaited<ReturnType<typeof createInventoryFixture>>;
  let hostelA: string;
  let hostelB: string;
  let maggi: string;
  let water: string;
  let unstocked: string;

  // Admins edit stock per stock group; each fixture hostel has a group of its own.
  const getHostelInventory = async (hostelId: string) => getStockGroupInventory(await fx.groupOf(hostelId));
  const updateHostelInventory = async (hostelId: string, entries: unknown) =>
    updateStockGroupInventory(await fx.groupOf(hostelId), entries);

  const rowFor = async (hostelId: string, productId: string) =>
    (await getHostelInventory(hostelId)).products.find((p) => p.productId === productId);

  beforeAll(async () => {
    fx = await createInventoryFixture();
    hostelA = (await fx.hostel("Stock Hostel A")).id;
    hostelB = (await fx.hostel("Stock Hostel B")).id;
    maggi = (await fx.product("Stock Maggi")).id;
    water = (await fx.product("Stock Water")).id;
    unstocked = (await fx.product("Stock Unstocked")).id;
  });

  beforeEach(async () => {
    await prisma.inventoryReservation.deleteMany({ where: { userId: { in: fx.ids.users } } });
    await prisma.productInventory.deleteMany({ where: { productId: unstocked } });
    await fx.setStock(maggi, hostelA, 10);
    await fx.setStock(maggi, hostelB, 10);
    await fx.setStock(water, hostelA, 5);
    await fx.setStock(water, hostelB, 5);
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it("lists a product with no stock row as unavailable with zero, without creating a row", async () => {
    expect(await rowFor(hostelA, unstocked)).toMatchObject({ isAvailable: false, quantity: 0, exists: false });
    expect(await prisma.productInventory.count({ where: { productId: unstocked } })).toBe(0);
  });

  it("saves several products for one hostel and leaves other hostels unchanged", async () => {
    await updateHostelInventory(hostelA, [
      { productId: maggi, isAvailable: true, quantity: 20, expectedQuantity: 10 },
      { productId: water, isAvailable: false, quantity: 0, expectedQuantity: 5 },
      { productId: unstocked, isAvailable: true, quantity: 0, expectedQuantity: 0 },
    ]);

    expect(await rowFor(hostelA, maggi)).toMatchObject({ isAvailable: true, quantity: 20 });
    expect(await rowFor(hostelA, water)).toMatchObject({ isAvailable: false, quantity: 0 });
    // Available but out of stock is distinct from unavailable.
    expect(await rowFor(hostelA, unstocked)).toMatchObject({ isAvailable: true, quantity: 0, exists: true });
    expect(await fx.stock(maggi, hostelB)).toBe(10);
    expect(await fx.stock(water, hostelB)).toBe(5);
  });

  it("keeps units held for a payment in progress when the admin edits stock", async () => {
    const customer = await fx.customer(hostelA);
    await createOrder(customer.firebaseUid, { hostelId: hostelA, items: [{ productId: maggi, quantity: 3 }] });
    const before = await rowFor(hostelA, maggi);
    expect(before).toMatchObject({ quantity: 7, reserved: 3 });

    await updateHostelInventory(hostelA, [{ productId: maggi, isAvailable: true, quantity: 15, expectedQuantity: 7 }]);

    expect(await rowFor(hostelA, maggi)).toMatchObject({ quantity: 15, reserved: 3 });
    expect(await prisma.inventoryReservation.count({ where: { userId: customer.id, status: "ACTIVE" } })).toBe(1);

    // When that hold expires, its units return on top of the admin's new quantity.
    await prisma.inventoryReservation.updateMany({ where: { userId: customer.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expireReservations();
    expect(await fx.stock(maggi, hostelA)).toBe(18);
  });

  it("saves nothing when any product's stock changed since the admin opened the hostel", async () => {
    const opened = await getHostelInventory(hostelA); // admin loads: maggi 10, water 5
    const customer = await fx.customer(hostelA);
    await createOrder(customer.firebaseUid, { hostelId: hostelA, items: [{ productId: maggi, quantity: 2 }] });

    const expected = (id: string) => opened.products.find((p) => p.productId === id)!.quantity;
    await expect(
      updateHostelInventory(hostelA, [
        { productId: water, isAvailable: true, quantity: 50, expectedQuantity: expected(water) },
        { productId: maggi, isAvailable: true, quantity: 40, expectedQuantity: expected(maggi) },
      ])
    ).rejects.toMatchObject({ statusCode: 409 });

    // Water's earlier write in the same save was rolled back.
    expect(await fx.stock(water, hostelA)).toBe(5);
    expect(await fx.stock(maggi, hostelA)).toBe(8);
  });

  it("lets admins prepare stock at an inactive hostel and keeps its records", async () => {
    await prisma.hostel.update({ where: { id: hostelB }, data: { isActive: false } });
    try {
      const inventory = await updateHostelInventory(hostelB, [
        { productId: maggi, isAvailable: true, quantity: 4, expectedQuantity: 10 },
      ]);
      expect(inventory.active).toBe(false);
      expect(await fx.stock(maggi, hostelB)).toBe(4);
      expect(await fx.stock(water, hostelB)).toBe(5);
    } finally {
      await prisma.hostel.update({ where: { id: hostelB }, data: { isActive: true } });
    }
  });

  it("rejects a soft-deleted product and writes nothing", async () => {
    await prisma.product.update({ where: { id: unstocked }, data: { isDeleted: true } });
    try {
      await expect(
        updateHostelInventory(hostelA, [
          { productId: maggi, isAvailable: true, quantity: 1 },
          { productId: unstocked, isAvailable: true, quantity: 1 },
        ])
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(await fx.stock(maggi, hostelA)).toBe(10);
      expect((await getHostelInventory(hostelA)).products.some((p) => p.productId === unstocked)).toBe(false);
    } finally {
      await prisma.product.update({ where: { id: unstocked }, data: { isDeleted: false } });
    }
  });
});
