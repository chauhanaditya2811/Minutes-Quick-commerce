import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/config/database.js";
import {
  consumeReservation,
  expireReservations,
  releaseReservation,
  reserveMultipleProducts,
  reserveStock,
} from "../../src/services/inventory.service.js";

describe("Inventory reservation service", () => {
  let userId: string | undefined;
  let productId: string | undefined;

  beforeAll(async () => {
    const [database] = await prisma.$queryRaw<{ name: string }[]>`
      SELECT current_database() AS name
    `;

    if (database?.name !== "minutes_test") {
      throw new Error("Inventory tests must connect to minutes_test.");
    }

    const uniqueId = crypto.randomUUID();

    const user = await prisma.user.create({
      data: {
        firebaseUid: `inventory-test-${uniqueId}`,
        email: `inventory-test-${uniqueId}@example.com`,
        name: "Inventory Test User",
      },
    });

    userId = user.id;

    const product = await prisma.product.create({
      data: {
        name: "Inventory Test Product",
        description: "Product created for automated inventory testing",
        imageUrl: "https://example.com/inventory-test.jpg",
        price: 100,
        unit: "piece",
        stock: 10,
      },
    });

    productId = product.id;
  });

  afterEach(async () => {
    if (!productId) {
      return;
    }

    await prisma.inventoryReservation.deleteMany({
      where: { productId },
    });
    await prisma.product.update({
      where: { id: productId },
      data: { stock: 10, isDeleted: false },
    });
  });

  afterAll(async () => {
    try {
      if (productId) {
        await prisma.inventoryReservation.deleteMany({
          where: { productId },
        });

        await prisma.product.deleteMany({
          where: { id: productId },
        });
      }

      if (userId) {
        await prisma.user.deleteMany({
          where: { id: userId },
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it("reserves stock and creates an active reservation", async () => {
    if (!userId || !productId) {
      throw new Error("Test user and product were not created.");
    }

    const reservation = await reserveStock(userId, productId, 3);

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });

    expect(reservation.quantity).toBe(3);
    expect(reservation.status).toBe("ACTIVE");
    expect(product.stock).toBe(7);
  });

  it("rejects invalid and insufficient quantities without changing stock", async () => {
    if (!userId || !productId) {
      throw new Error("Test user and product were not created.");
    }

    await expect(reserveStock(userId, productId, 0)).rejects.toThrow(
      "Quantity must be a positive integer."
    );
    await expect(reserveStock(userId, productId, 11)).rejects.toThrow(
      "Insufficient stock."
    );

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });
    expect(product.stock).toBe(10);
  });

  it("allows only one concurrent reservation for the last unit", async () => {
    if (!userId || !productId) {
      throw new Error("Test user and product were not created.");
    }

    await prisma.product.update({
      where: { id: productId },
      data: { stock: 1 },
    });

    const results = await Promise.allSettled([
      reserveStock(userId, productId, 1),
      reserveStock(userId, productId, 1),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof reserveStock>>
      > => result.status === "fulfilled"
    );
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });
    const activeReservations = await prisma.inventoryReservation.count({
      where: { productId, status: "ACTIVE" },
    });

    expect(fulfilled).toHaveLength(1);
    expect(product.stock).toBe(0);
    expect(activeReservations).toBe(1);
  });

  it("aggregates duplicate products when reserving multiple items", async () => {
    if (!userId || !productId) {
      throw new Error("Test user and product were not created.");
    }

    const reservations = await reserveMultipleProducts(userId, [
      { productId, quantity: 2 },
      { productId, quantity: 3 },
    ]);
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });

    expect(reservations).toHaveLength(1);
    expect(reservations[0]?.quantity).toBe(5);
    expect(product.stock).toBe(5);
  });

  it("rolls back every stock change when a multi-product reservation fails", async () => {
    if (!userId || !productId) {
      throw new Error("Test user and product were not created.");
    }

    const secondProduct = await prisma.product.create({
      data: {
        name: "Inventory Rollback Test Product",
        imageUrl: "https://example.com/inventory-rollback-test.jpg",
        price: 50,
        unit: "piece",
        stock: 1,
      },
    });

    try {
      await expect(
        reserveMultipleProducts(userId, [
          { productId, quantity: 2 },
          { productId: secondProduct.id, quantity: 2 },
        ])
      ).rejects.toThrow(
        `Product ${secondProduct.id} is unavailable or has insufficient stock.`
      );

      const [firstAfter, secondAfter, reservations] = await Promise.all([
        prisma.product.findUniqueOrThrow({ where: { id: productId } }),
        prisma.product.findUniqueOrThrow({
          where: { id: secondProduct.id },
        }),
        prisma.inventoryReservation.count({
          where: { productId: { in: [productId, secondProduct.id] } },
        }),
      ]);

      expect(firstAfter.stock).toBe(10);
      expect(secondAfter.stock).toBe(1);
      expect(reservations).toBe(0);
    } finally {
      await prisma.inventoryReservation.deleteMany({
        where: { productId: secondProduct.id },
      });
      await prisma.product.delete({
        where: { id: secondProduct.id },
      });
    }
  });

  it("does not reserve stock for a deleted product", async () => {
    if (!userId || !productId) {
      throw new Error("Test user and product were not created.");
    }

    await prisma.product.update({
      where: { id: productId },
      data: { isDeleted: true },
    });

    await expect(reserveStock(userId, productId, 1)).rejects.toThrow(
      "Product not found."
    );
  });

  it("restores stock once when releasing an active reservation", async () => {
    if (!userId || !productId) {
      throw new Error("Test user and product were not created.");
    }

    const reservation = await reserveStock(userId, productId, 3);
    const released = await releaseReservation(reservation.id, userId);

    expect(released.status).toBe("RELEASED");
    await expect(
      releaseReservation(reservation.id, userId)
    ).rejects.toThrow("Reservation not found or no longer active.");

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });
    expect(product.stock).toBe(10);
  });

  it("consumes an active reservation without restoring stock", async () => {
    if (!userId || !productId) {
      throw new Error("Test user and product were not created.");
    }

    const reservation = await reserveStock(userId, productId, 3);
    const consumed = await consumeReservation(reservation.id, userId);
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });

    expect(consumed.status).toBe("CONSUMED");
    expect(product.stock).toBe(7);
  });

  it("rejects consumption after the reservation has expired", async () => {
    if (!userId || !productId) {
      throw new Error("Test user and product were not created.");
    }

    const reservation = await reserveStock(userId, productId, 3);
    await prisma.inventoryReservation.update({
      where: { id: reservation.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(
      consumeReservation(reservation.id, userId)
    ).rejects.toThrow("Reservation not found, expired, or no longer active.");

    const [unchangedReservation, product] = await Promise.all([
      prisma.inventoryReservation.findUniqueOrThrow({
        where: { id: reservation.id },
      }),
      prisma.product.findUniqueOrThrow({ where: { id: productId } }),
    ]);

    expect(unchangedReservation.status).toBe("ACTIVE");
    expect(product.stock).toBe(7);
  });

  it("does not consume an already consumed reservation twice", async () => {
    if (!userId || !productId) {
      throw new Error("Test user and product were not created.");
    }

    const reservation = await reserveStock(userId, productId, 3);
    await consumeReservation(reservation.id, userId);

    await expect(
      consumeReservation(reservation.id, userId)
    ).rejects.toThrow("Reservation not found, expired, or no longer active.");

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });
    expect(product.stock).toBe(7);
  });

  it("expires overdue reservations and restores stock only once", async () => {
    if (!userId || !productId) {
      throw new Error("Test user and product were not created.");
    }

    const reservation = await reserveStock(userId, productId, 3);
    await prisma.inventoryReservation.update({
      where: { id: reservation.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(expireReservations()).resolves.toEqual({ expiredCount: 1 });

    const expired = await prisma.inventoryReservation.findUniqueOrThrow({
      where: { id: reservation.id },
    });
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });

    expect(expired.status).toBe("EXPIRED");
    expect(product.stock).toBe(10);
    await expect(expireReservations()).resolves.toEqual({ expiredCount: 0 });
  });
});
