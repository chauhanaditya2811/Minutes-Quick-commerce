import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/config/database.js";
import {
  consumeOrderReservations,
  expireReservations,
  extendOrClaimReservations,
  releaseUserPendingReservations,
  reserveOrderStock,
} from "../../src/services/inventory.service.js";
import { createInventoryFixture } from "./fixtures.js";

// Runs against the real minutes_test database: these tests prove the SQL-level guarantees.
describe("hostel inventory reservations (minutes_test)", () => {
  let fx: Awaited<ReturnType<typeof createInventoryFixture>>;
  let hostelA: string;
  let hostelB: string;
  let maggi: string;
  let water: string;
  let userId: string;

  const inFuture = (minutes = 15) => new Date(Date.now() + minutes * 60_000);
  const reserve = (orderId: string, items: { productId: string; quantity: number }[], hostelId = hostelA, expiresAt = inFuture()) =>
    prisma.$transaction((tx) => reserveOrderStock(tx, { userId, orderId, hostelId, items, expiresAt }));
  const orderTarget = (order: { id: string; hostelId: string | null; items: { productId: string; quantity: number }[] }) => ({
    id: order.id,
    userId,
    hostelId: order.hostelId,
    items: order.items.map(({ productId, quantity }) => ({ productId, quantity })),
  });

  beforeAll(async () => {
    fx = await createInventoryFixture();
    hostelA = (await fx.hostel("Svc Hostel A")).id;
    hostelB = (await fx.hostel("Svc Hostel B")).id;
    maggi = (await fx.product("Svc Maggi")).id;
    water = (await fx.product("Svc Water")).id;
    userId = (await fx.customer(hostelA)).id;
  });

  beforeEach(async () => {
    await prisma.inventoryReservation.deleteMany({ where: { userId } });
    await fx.setStock(maggi, hostelA, 10);
    await fx.setStock(maggi, hostelB, 10);
    await fx.setStock(water, hostelA, 5);
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it("takes stock only from the order's hostel", async () => {
    const order = await fx.pendingOrder(userId, hostelA, [{ productId: maggi, quantity: 2 }]);
    await reserve(order.id, [{ productId: maggi, quantity: 2 }]);

    expect(await fx.stock(maggi, hostelA)).toBe(8);
    expect(await fx.stock(maggi, hostelB)).toBe(10);
    const [hold] = await prisma.inventoryReservation.findMany({ where: { orderId: order.id } });
    expect(hold).toMatchObject({ status: "ACTIVE", hostelId: hostelA, quantity: 2 });
  });

  it("rejects a request above available stock and rolls back every item", async () => {
    const order = await fx.pendingOrder(userId, hostelA, []);
    await expect(
      reserve(order.id, [
        { productId: maggi, quantity: 3 },
        { productId: water, quantity: 6 },
      ])
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(await fx.stock(maggi, hostelA)).toBe(10);
    expect(await fx.stock(water, hostelA)).toBe(5);
    expect(await prisma.inventoryReservation.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("never reserves a product disabled at the hostel", async () => {
    await fx.setStock(maggi, hostelA, 10, false);
    const order = await fx.pendingOrder(userId, hostelA, []);
    await expect(reserve(order.id, [{ productId: maggi, quantity: 1 }])).rejects.toMatchObject({ statusCode: 409 });
    expect(await fx.stock(maggi, hostelA)).toBe(10);
  });

  it("lets only one of two concurrent reservations take the last unit", async () => {
    await fx.setStock(maggi, hostelA, 1);
    const first = await fx.pendingOrder(userId, hostelA, []);
    const second = await fx.pendingOrder(userId, hostelA, []);

    const results = await Promise.allSettled([
      reserve(first.id, [{ productId: maggi, quantity: 1 }]),
      reserve(second.id, [{ productId: maggi, quantity: 1 }]),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await fx.stock(maggi, hostelA)).toBe(0);
    expect(await prisma.inventoryReservation.count({ where: { userId, status: "ACTIVE" } })).toBe(1);
  });

  it("never over-reserves limited stock under many concurrent requests", async () => {
    await fx.setStock(maggi, hostelA, 3);
    const orders = await Promise.all(Array.from({ length: 6 }, () => fx.pendingOrder(userId, hostelA, [])));

    const results = await Promise.allSettled(orders.map((o) => reserve(o.id, [{ productId: maggi, quantity: 1 }])));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await fx.stock(maggi, hostelA)).toBe(0);
    const held = await prisma.inventoryReservation.aggregate({ where: { userId, status: "ACTIVE" }, _sum: { quantity: true } });
    expect(held._sum.quantity).toBe(3);
  });

  it("expires overdue holds and returns their stock exactly once", async () => {
    const order = await fx.pendingOrder(userId, hostelA, [{ productId: maggi, quantity: 4 }]);
    await reserve(order.id, [{ productId: maggi, quantity: 4 }], hostelA, new Date(Date.now() - 1000));
    expect(await fx.stock(maggi, hostelA)).toBe(6);

    // Concurrent and repeated runs (other test files may also be running expiry) must restore once:
    // a double restore would leave 14.
    await Promise.all([expireReservations(), expireReservations()]);
    await expireReservations();

    expect(await fx.stock(maggi, hostelA)).toBe(10);
    expect(await prisma.inventoryReservation.findFirst({ where: { orderId: order.id } })).toMatchObject({ status: "EXPIRED" });
  });

  it("does not expire a hold that a payment retry has extended", async () => {
    const order = await fx.pendingOrder(userId, hostelA, [{ productId: maggi, quantity: 2 }]);
    await reserve(order.id, [{ productId: maggi, quantity: 2 }], hostelA, new Date(Date.now() - 1000));

    await prisma.$transaction((tx) => extendOrClaimReservations(tx, orderTarget(order)));
    await expireReservations();

    // Whether the retry extended the hold or (if another file's expiry ran first) re-took it,
    // exactly 2 units stay held under one live reservation.
    expect(await fx.stock(maggi, hostelA)).toBe(8);
    const live = await prisma.inventoryReservation.findMany({ where: { orderId: order.id, status: "ACTIVE" } });
    expect(live).toHaveLength(1);
    expect(live[0].quantity).toBe(2);
    expect(live[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("re-takes stock when payment restarts after the hold expired", async () => {
    const order = await fx.pendingOrder(userId, hostelA, [{ productId: maggi, quantity: 2 }]);
    await reserve(order.id, [{ productId: maggi, quantity: 2 }], hostelA, new Date(Date.now() - 1000));
    await expireReservations();
    expect(await fx.stock(maggi, hostelA)).toBe(10);

    await prisma.$transaction((tx) => extendOrClaimReservations(tx, orderTarget(order)));

    expect(await fx.stock(maggi, hostelA)).toBe(8);
    expect(await prisma.inventoryReservation.count({ where: { orderId: order.id, status: "ACTIVE" } })).toBe(1);
  });

  it("refuses to restart payment when the expired hold's stock has gone", async () => {
    const order = await fx.pendingOrder(userId, hostelA, [{ productId: maggi, quantity: 2 }]);
    await reserve(order.id, [{ productId: maggi, quantity: 2 }], hostelA, new Date(Date.now() - 1000));
    await expireReservations();
    await fx.setStock(maggi, hostelA, 1);

    await expect(
      prisma.$transaction((tx) => extendOrClaimReservations(tx, orderTarget(order)))
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await fx.stock(maggi, hostelA)).toBe(1);
  });

  it("releases a customer's holds on their other unpaid orders", async () => {
    const abandoned = await fx.pendingOrder(userId, hostelA, [{ productId: maggi, quantity: 3 }]);
    await reserve(abandoned.id, [{ productId: maggi, quantity: 3 }]);
    const current = await fx.pendingOrder(userId, hostelA, [{ productId: maggi, quantity: 1 }]);
    await reserve(current.id, [{ productId: maggi, quantity: 1 }]);

    const released = await prisma.$transaction((tx) => releaseUserPendingReservations(tx, userId, current.id));

    expect(released).toBe(1);
    expect(await fx.stock(maggi, hostelA)).toBe(9);
    expect(await prisma.inventoryReservation.findFirst({ where: { orderId: abandoned.id } })).toMatchObject({ status: "RELEASED" });
  });

  it("consumes live holds without taking stock a second time", async () => {
    const order = await fx.pendingOrder(userId, hostelA, [{ productId: maggi, quantity: 2 }]);
    await reserve(order.id, [{ productId: maggi, quantity: 2 }]);

    const result = await prisma.$transaction((tx) => consumeOrderReservations(tx, orderTarget(order)));

    expect(result.shortfall).toBe(false);
    expect(await fx.stock(maggi, hostelA)).toBe(8);
    expect(await prisma.inventoryReservation.findFirst({ where: { orderId: order.id } })).toMatchObject({ status: "CONSUMED" });
    // A later expiry run must not hand consumed stock back.
    await prisma.inventoryReservation.updateMany({ where: { orderId: order.id }, data: { expiresAt: new Date(0) } });
    await expireReservations();
    expect(await fx.stock(maggi, hostelA)).toBe(8);
  });

  it("takes as much as is left, never below zero, and reports a shortfall", async () => {
    const order = await fx.pendingOrder(userId, hostelA, [{ productId: maggi, quantity: 4 }]);
    await fx.setStock(maggi, hostelA, 1);

    const result = await prisma.$transaction((tx) => consumeOrderReservations(tx, orderTarget(order)));

    expect(result.shortfall).toBe(true);
    expect(await fx.stock(maggi, hostelA)).toBe(0);
    expect(await prisma.inventoryReservation.findFirst({ where: { orderId: order.id } })).toMatchObject({
      status: "CONSUMED",
      quantity: 1,
    });
  });

  it("leaves stock untouched for orders placed before hostel inventory", async () => {
    const legacy = await fx.pendingOrder(userId, null, [{ productId: maggi, quantity: 2 }]);
    const result = await prisma.$transaction((tx) => consumeOrderReservations(tx, orderTarget(legacy)));
    expect(result.shortfall).toBe(false);
    expect(await fx.stock(maggi, hostelA)).toBe(10);
    expect(await fx.stock(maggi, hostelB)).toBe(10);
  });
});
