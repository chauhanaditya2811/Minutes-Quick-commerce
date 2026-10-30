import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/config/database.js";
import { createOrder, validateCheckout } from "../../src/services/order.service.js";
import { expireReservations } from "../../src/services/inventory.service.js";
import { getHostelCatalog, getStockGroupInventory } from "../../src/services/product-inventory.service.js";
import { clearPopularityCache, getRecentOrderCounts } from "../../src/services/product-popularity.service.js";
import { createStockGroup, deleteStockGroup, moveHostelToGroup, updateStockGroup } from "../../src/services/stock-group.service.js";
import { createInventoryFixture } from "./fixtures.js";

// Several hostels selling from one shared stock, against the real minutes_test database.
describe("shared stock groups (minutes_test)", () => {
  let fx: Awaited<ReturnType<typeof createInventoryFixture>>;
  let boys: string; // shared group
  let bh1: string;
  let bh2: string;
  let girls: string; // a hostel with its own stock
  let maggi: string;

  const stockAt = async (hostelId: string) =>
    (await getHostelCatalog(hostelId)).find((product) => product.id === maggi)?.stock;
  const checkout = (firebaseUid: string, hostelId: string, quantity: number) =>
    createOrder(firebaseUid, { hostelId, items: [{ productId: maggi, quantity }] });

  beforeAll(async () => {
    fx = await createInventoryFixture();
    bh1 = (await fx.hostel("BH-1")).id;
    boys = await fx.groupOf(bh1);
    await prisma.stockGroup.update({ where: { id: boys }, data: { name: `Boys store ${fx.tag}` } });
    bh2 = (await fx.hostel("BH-2", boys)).id;
    girls = (await fx.hostel("GH-1")).id;
    maggi = (await fx.product("Shared Maggi")).id;
  });

  beforeEach(async () => {
    await prisma.inventoryReservation.deleteMany({ where: { productId: maggi } });
    await fx.setStock(maggi, bh1, 10); // the boys' shared shelf
    await fx.setStock(maggi, girls, 4);
    clearPopularityCache();
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it("shows every hostel in a group the same shared stock, and other groups their own", async () => {
    expect(await stockAt(bh1)).toBe(10);
    expect(await stockAt(bh2)).toBe(10);
    expect(await stockAt(girls)).toBe(4);
  });

  it("takes an order at one hostel from the stock every hostel in the group sees", async () => {
    const student = await fx.customer(bh2);
    const order = await checkout(student.firebaseUid, bh2, 3);

    expect(order.hostelId).toBe(bh2); // delivered to BH-2…
    expect(await stockAt(bh1)).toBe(7); // …from the shelf BH-1 shares
    expect(await stockAt(bh2)).toBe(7);
    expect(await stockAt(girls)).toBe(4);
    expect(await prisma.inventoryReservation.findFirst({ where: { orderId: order.id } })).toMatchObject({
      hostelId: bh2,
      stockGroupId: boys,
      status: "ACTIVE",
    });
  });

  it("never sells the group's last unit twice to students in different hostels", async () => {
    await fx.setStock(maggi, bh1, 1);
    const [a, b] = [await fx.customer(bh1), await fx.customer(bh2)];
    const results = await Promise.allSettled([checkout(a.firebaseUid, bh1, 1), checkout(b.firebaseUid, bh2, 1)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await fx.stock(maggi, bh1)).toBe(0);
  });

  it("returns an expired hold to the group it came from, even after the hostel moves", async () => {
    const student = await fx.customer(bh2);
    const order = await checkout(student.firebaseUid, bh2, 2);
    const own = await createStockGroup({ name: `Temp ${fx.tag}`, hostelIds: [bh2] });

    await prisma.inventoryReservation.updateMany({ where: { orderId: order.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expireReservations();

    expect(await fx.stock(maggi, bh1)).toBe(10); // back on the boys' shelf
    expect(await prisma.productInventory.count({ where: { stockGroupId: own.id } })).toBe(0);
    await updateStockGroup(boys, { hostelIds: [bh1, bh2] }); // move BH-2 back
    await deleteStockGroup(own.id);
  });

  it("lets a signed-in student shop at any hostel of their delivery hostel's group", async () => {
    const student = await fx.customer(bh1);
    const priced = await validateCheckout(student.firebaseUid, { hostelId: bh2, items: [{ productId: maggi, quantity: 1 }] });
    expect(priced.hostelId).toBe(bh1);

    await expect(
      validateCheckout(student.firebaseUid, { hostelId: girls, items: [{ productId: maggi, quantity: 1 }] })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("ranks the most ordered products across the whole group", async () => {
    const order = await fx.pendingOrder((await fx.customer(bh2)).id, bh2, [{ productId: maggi, quantity: 1 }]);
    await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "SUCCESS", orderStatus: "CONFIRMED" } });

    expect((await getRecentOrderCounts(boys)).get(maggi)).toBe(1);
    expect((await getRecentOrderCounts(await fx.groupOf(girls))).get(maggi)).toBeUndefined();
  });

  describe("managing groups", () => {
    it("moves hostels into a group, and gives a hostel taken out a fresh group of its own", async () => {
      const extra = (await fx.hostel("BH-3")).id;
      const oldGroup = await fx.groupOf(extra);
      await updateStockGroup(boys, { hostelIds: [bh1, bh2, extra] });
      expect(await fx.groupOf(extra)).toBe(boys);
      expect(await stockAt(extra)).toBe(10);

      const updated = await updateStockGroup(boys, { name: `Boys store ${fx.tag}`, hostelIds: [bh1, bh2] });
      expect(updated.hostels.map((h) => h.id).sort()).toEqual([bh1, bh2].sort());
      const fresh = await fx.groupOf(extra);
      expect(fresh).not.toBe(boys);
      expect(await stockAt(extra)).toBeUndefined(); // new shelf starts empty

      // The group BH-3 started with now serves nobody and can be deleted.
      await deleteStockGroup(oldGroup);
      expect(await prisma.stockGroup.findUnique({ where: { id: oldGroup } })).toBeNull();
    });

    it("starts a new pool's stock as a copy of one hostel's current stock, without touching the original", async () => {
      const gh2 = (await fx.hostel("GH-2")).id;
      const gh2Group = await fx.groupOf(gh2);
      await fx.setStock(maggi, gh2, 7);
      const water = (await fx.product("Copy Water")).id;
      await fx.setStock(water, gh2, 0, false);

      const pool = await createStockGroup({ name: `Girls pool ${fx.tag}`, hostelIds: [girls, gh2], copyStockFromHostelId: gh2 });

      expect(pool.hostels.map((h) => h.id).sort()).toEqual([girls, gh2].sort());
      expect(await fx.stock(maggi, girls)).toBe(7); // both now sell from the copy
      expect(await prisma.productInventory.findUnique({ where: { productId_stockGroupId: { productId: water, stockGroupId: pool.id } } }))
        .toMatchObject({ quantity: 0, isAvailable: false });
      // GH-2's old stock is kept as it was, for reference, until the admin deletes it.
      expect(await prisma.productInventory.findUnique({ where: { productId_stockGroupId: { productId: maggi, stockGroupId: gh2Group } } }))
        .toMatchObject({ quantity: 7 });

      // Put GH-1 back on a stock of its own for the other tests.
      await moveHostelToGroup(girls, {});
      await fx.setStock(maggi, girls, 4);
    });

    it("moves one hostel into another pool, or out to a new empty pool of its own", async () => {
      const bh4 = (await fx.hostel("BH-4")).id;
      const own = await fx.groupOf(bh4);

      const moved = await moveHostelToGroup(bh4, { stockGroupId: boys });
      expect(moved.stockGroup).toMatchObject({ id: boys });
      expect(await stockAt(bh4)).toBe(10);

      const alone = await moveHostelToGroup(bh4, {});
      expect(alone.stockGroupId).not.toBe(boys);
      expect(alone.stockGroup.name).toBe(alone.name);
      expect(await stockAt(bh4)).toBeUndefined();

      await expect(moveHostelToGroup(bh4, { stockGroupId: "no-such-pool" })).rejects.toMatchObject({ statusCode: 400 });
      await expect(moveHostelToGroup("no-such-hostel", {})).rejects.toMatchObject({ statusCode: 404 });
      await deleteStockGroup(own); // its first pool is unused now
    });

    it("keeps every hostel in exactly one pool, whichever way it is moved", async () => {
      const bh5 = (await fx.hostel("BH-5")).id;
      const other = await createStockGroup({ name: `Other ${fx.tag}` });
      const memberships = async () =>
        (await prisma.stockGroup.findMany({ where: { hostels: { some: { id: bh5 } } }, select: { id: true } })).map((g) => g.id);

      expect(await memberships()).toHaveLength(1);
      await updateStockGroup(boys, { hostelIds: [bh1, bh2, bh5] }); // ticked into the boys' pool
      expect(await memberships()).toEqual([boys]);
      await createStockGroup({ name: `Grab ${fx.tag}`, hostelIds: [bh5] }); // ticked into a new pool
      expect(await memberships()).toHaveLength(1);
      await moveHostelToGroup(bh5, { stockGroupId: other.id }); // "Move to…"
      expect(await memberships()).toEqual([other.id]);
      expect((await prisma.stockGroup.findUniqueOrThrow({ where: { id: boys }, include: { hostels: true } })).hostels.map((h) => h.id)).not.toContain(bh5);

      // The database itself allows only one pool per hostel: there is no second slot to fill.
      await expect(
        prisma.$executeRaw`UPDATE "hostels" SET "stockGroupId" = NULL WHERE "id" = ${bh5}`
      ).rejects.toThrow();
    });

    it("refuses to delete a group that still serves hostels or holds units for payments", async () => {
      await expect(deleteStockGroup(boys)).rejects.toMatchObject({ statusCode: 409 });

      const empty = await createStockGroup({ name: `Empty ${fx.tag}` });
      await prisma.productInventory.create({ data: { productId: maggi, stockGroupId: empty.id, quantity: 3, isAvailable: true } });
      await prisma.inventoryReservation.create({
        data: { productId: maggi, stockGroupId: empty.id, quantity: 1, expiresAt: new Date(Date.now() + 60_000) },
      });
      await expect(deleteStockGroup(empty.id)).rejects.toMatchObject({ statusCode: 409 });

      await prisma.inventoryReservation.deleteMany({ where: { stockGroupId: empty.id } });
      await deleteStockGroup(empty.id);
      expect(await prisma.productInventory.count({ where: { stockGroupId: empty.id } })).toBe(0);
    });

    it("lists a group's hostels with its stock for admins", async () => {
      const inventory = await getStockGroupInventory(boys);
      expect(inventory.hostels.map((h) => h.id).sort()).toEqual([bh1, bh2].sort());
      expect(inventory.active).toBe(true);
      expect(inventory.products.find((p) => p.productId === maggi)).toMatchObject({ quantity: 10, isAvailable: true });
    });

    it.each([
      ["a blank name", { name: "  " }],
      ["unknown hostels", { name: "X", hostelIds: ["no-such-hostel"] }],
      ["a non-list of hostels", { name: "X", hostelIds: "bh1" }],
    ])("rejects %s", async (_label, input) => {
      await expect(createStockGroup(input)).rejects.toMatchObject({ statusCode: 400 });
    });
  });
});
