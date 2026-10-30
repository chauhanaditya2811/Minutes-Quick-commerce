import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OrderStatus, PaymentStatus } from "../../src/generated/prisma/client.js";
import { prisma } from "../../src/config/database.js";
import { getHostelCatalog } from "../../src/services/product-inventory.service.js";
import { clearPopularityCache, getRecentOrderCounts } from "../../src/services/product-popularity.service.js";
import { createInventoryFixture } from "./fixtures.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Most-ordered-first catalogue against the real minutes_test database.
describe("most ordered first (minutes_test)", () => {
  let fx: Awaited<ReturnType<typeof createInventoryFixture>>;
  let hostelA: string;
  let hostelB: string;
  const p: Record<string, string> = {};
  const customers: Record<string, string> = {};

  const order = async (
    hostelId: string,
    items: { productId: string; quantity?: number }[],
    opts: { paymentStatus?: PaymentStatus; orderStatus?: OrderStatus; daysAgo?: number } = {}
  ) => {
    const row = await prisma.order.create({
      data: {
        orderNumber: `MIN-POP-${fx.tag}-${randomUUID().slice(0, 8)}`,
        userId: customers[hostelId],
        hostelId,
        subtotal: 20,
        deliveryFee: 0,
        total: 20,
        paymentStatus: opts.paymentStatus ?? "SUCCESS",
        orderStatus: opts.orderStatus ?? "CONFIRMED",
        createdAt: new Date(Date.now() - (opts.daysAgo ?? 1) * DAY_MS),
        customerName: "Popularity Test",
        customerPhone: "9876543210",
        customerHostel: "Test",
        customerFloor: "A/1",
        customerRoom: "101",
        items: {
          create: items.map(({ productId, quantity = 1 }) => ({
            productId,
            productName: "Test",
            price: 20,
            unit: "pack",
            quantity,
            subtotal: 20 * quantity,
          })),
        },
      },
    });
    fx.trackOrder(row.id);
  };

  const times = (n: number, fn: () => Promise<void>) => Promise.all(Array.from({ length: n }, fn));
  const names = (catalogue: { id: string }[]) =>
    catalogue.map((item) => Object.keys(p).find((key) => p[key] === item.id));

  beforeAll(async () => {
    fx = await createInventoryFixture();
    hostelA = (await fx.hostel("Popular Hostel A")).id;
    hostelB = (await fx.hostel("Popular Hostel B")).id;
    for (const hostelId of [hostelA, hostelB]) customers[hostelId] = (await fx.customer(hostelId)).id;
    for (const name of ["maggi", "water", "chips", "choco", "soap", "soldOut", "fresh"]) {
      p[name] = (await fx.product(`Pop ${name}`)).id;
    }
    // Everything except "fresh" was added long ago, so only "fresh" counts as new.
    await prisma.product.updateMany({
      where: { id: { in: Object.values(p).filter((id) => id !== p.fresh) } },
      data: { createdAt: new Date(Date.now() - 60 * DAY_MS) },
    });
    for (const id of Object.values(p)) {
      await fx.setStock(id, hostelA, id === p.soldOut ? 0 : 10);
      await fx.setStock(id, hostelB, 10);
    }

    // Hostel A, last 30 days, paid: maggi 5, water 3, chips 2, choco 1 (one bulk order), soldOut 6.
    await times(5, () => order(hostelA, [{ productId: p.maggi }]));
    await times(3, () => order(hostelA, [{ productId: p.water }]));
    await times(2, () => order(hostelA, [{ productId: p.chips }]));
    await order(hostelA, [{ productId: p.choco, quantity: 20 }]);
    await times(6, () => order(hostelA, [{ productId: p.soldOut }]));

    // None of these count for soap at hostel A.
    await order(hostelA, [{ productId: p.soap }], { paymentStatus: "PENDING", orderStatus: "PENDING_PAYMENT" });
    await order(hostelA, [{ productId: p.soap }], { paymentStatus: "FAILED", orderStatus: "PENDING_PAYMENT" });
    await order(hostelA, [{ productId: p.soap }], { orderStatus: "CANCELLED" });
    await order(hostelA, [{ productId: p.soap }], { daysAgo: 31 });
    await times(4, () => order(hostelB, [{ productId: p.soap }]));
  });

  beforeEach(() => clearPopularityCache());

  afterAll(async () => {
    await fx.cleanup();
  });

  it("counts paid orders from the last 30 days in that hostel's stock group only, one per order", async () => {
    const counts = await getRecentOrderCounts(await fx.groupOf(hostelA));
    expect(counts.get(p.maggi)).toBe(5);
    expect(counts.get(p.water)).toBe(3);
    expect(counts.get(p.chips)).toBe(2);
    expect(counts.get(p.choco)).toBe(1); // 20 units in one order still count once
    expect(counts.get(p.soap)).toBeUndefined(); // pending, failed, cancelled, old and other-hostel orders
  });

  it("lists most ordered first, new products after the top sellers and sold-out items last", async () => {
    const catalogue = await getHostelCatalog(hostelA);
    expect(names(catalogue)).toEqual(["maggi", "water", "chips", "fresh", "choco", "soap", "soldOut"]);
  });

  it("tags only the top in-stock sellers with at least two orders as popular", async () => {
    const catalogue = await getHostelCatalog(hostelA);
    const popular = catalogue.filter((item) => item.popular);
    expect(names(popular)).toEqual(["maggi", "water", "chips"]);
  });

  it("ranks each hostel by its own orders", async () => {
    const catalogue = await getHostelCatalog(hostelB);
    expect(names(catalogue)[0]).toBe("soap");
    expect(catalogue[0].popular).toBe(true);
  });

  it("keeps stock live while order counts are cached", async () => {
    await getHostelCatalog(hostelA);
    await fx.setStock(p.maggi, hostelA, 0);
    await times(10, () => order(hostelA, [{ productId: p.soap }]));

    const cached = await getHostelCatalog(hostelA);
    expect(cached.find((item) => item.id === p.maggi)?.stock).toBe(0);
    expect(names(cached).at(-1)).toBe("maggi"); // sold out goes last straight away
    expect(cached.find((item) => item.id === p.soap)?.popular).toBe(false); // counts wait for the cache

    clearPopularityCache();
    expect(names(await getHostelCatalog(hostelA))[0]).toBe("soap");
    await fx.setStock(p.maggi, hostelA, 10);
  });
});
