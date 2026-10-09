
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../config/database.js";

const MAX_TRANSACTION_ATTEMPTS = 3;

// Retries transactions that fail because of serialization conflicts.
const runSerializableTransaction = async <T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> => {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const isSerializationConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";

      if (!isSerializationConflict || attempt === MAX_TRANSACTION_ATTEMPTS) {
        throw error;
      }
    }
  }

  throw new Error("Transaction failed after maximum retry attempts.");
};

// Reserves available stock atomically for one product.
export const reserveStock = async (
  userId: string,
  productId: string,
  quantity: number
) => {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive integer.");
  }

  const lifetimeMinutes = Number(
    process.env.RESERVATION_LIFETIME_MINUTES ?? 5
  );

  if (!Number.isInteger(lifetimeMinutes) || lifetimeMinutes <= 0) {
    throw new Error("Reservation lifetime configuration is invalid.");
  }

  return runSerializableTransaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: {
        id: productId,
        isDeleted: false,
      },
      select: {
        id: true,
      },
    });

    if (!product) {
      throw new Error("Product not found.");
    }

    const updated = await tx.product.updateMany({
      where: {
        id: productId,
        isDeleted: false,
        stock: {
          gte: quantity,
        },
      },
      data: {
        stock: {
          decrement: quantity,
        },
      },
    });

    if (updated.count !== 1) {
      throw new Error("Insufficient stock.");
    }

    const expiresAt = new Date(
      Date.now() + lifetimeMinutes * 60 * 1000
    );

    return tx.inventoryReservation.create({
      data: {
        userId,
        productId,
        quantity,
        expiresAt,
      },
    });
  });
};

export interface ReservationItemInput {
  productId: string;
  quantity: number;
}

// Reserves multiple products atomically or rolls back every stock change.
export const reserveMultipleProducts = async (
  userId: string,
  items: ReservationItemInput[]
) => {
  if (items.length === 0) {
    throw new Error("At least one product is required.");
  }

  const quantities = new Map<string, number>();

  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("Every quantity must be a positive integer.");
    }

    if (!item.productId.trim()) {
      throw new Error("Every product must have a valid ID.");
    }

    quantities.set(
      item.productId,
      (quantities.get(item.productId) ?? 0) + item.quantity
    );
  }

  const lifetimeMinutes = Number(
    process.env.RESERVATION_LIFETIME_MINUTES ?? 5
  );

  if (!Number.isInteger(lifetimeMinutes) || lifetimeMinutes <= 0) {
    throw new Error("Reservation lifetime configuration is invalid.");
  }

  return runSerializableTransaction(async (tx) => {
    const reservations = [];

    const sortedItems = [...quantities.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    );

    for (const [productId, quantity] of sortedItems) {
      const updated = await tx.product.updateMany({
        where: {
          id: productId,
          isDeleted: false,
          stock: {
            gte: quantity,
          },
        },
        data: {
          stock: {
            decrement: quantity,
          },
        },
      });

      if (updated.count !== 1) {
        throw new Error(
          `Product ${productId} is unavailable or has insufficient stock.`
        );
      }

      reservations.push(
        await tx.inventoryReservation.create({
          data: {
            userId,
            productId,
            quantity,
            expiresAt: new Date(
              Date.now() + lifetimeMinutes * 60 * 1000
            ),
          },
        })
      );
    }

    return reservations;
  });
};

// Consumes an active reservation without restoring its stock.
export const consumeReservation = async (
  reservationId: string,
  userId: string
) => {
  return runSerializableTransaction(async (tx) => {
    const now = new Date();

    const updated = await tx.inventoryReservation.updateMany({
      where: {
        id: reservationId,
        userId,
        status: "ACTIVE",
        expiresAt: {
          gt: now,
        },
      },
      data: {
        status: "CONSUMED",
      },
    });

    if (updated.count !== 1) {
      throw new Error(
        "Reservation not found, expired, or no longer active."
      );
    }

    return tx.inventoryReservation.findUniqueOrThrow({
      where: {
        id: reservationId,
      },
    });
  });
};

// Releases an active reservation and restores its stock atomically.
export const releaseReservation = async (
  reservationId: string,
  userId: string
) => {
  return runSerializableTransaction(async (tx) => {
    const updated = await tx.inventoryReservation.updateMany({
      where: {
        id: reservationId,
        userId,
        status: "ACTIVE",
      },
      data: {
        status: "RELEASED",
      },
    });

    if (updated.count !== 1) {
      throw new Error("Reservation not found or no longer active.");
    }

    const reservation = await tx.inventoryReservation.findUniqueOrThrow({
      where: {
        id: reservationId,
      },
      select: {
        id: true,
        productId: true,
        quantity: true,
      },
    });

    await tx.product.update({
      where: {
        id: reservation.productId,
      },
      data: {
        stock: {
          increment: reservation.quantity,
        },
      },
    });

    return tx.inventoryReservation.findUniqueOrThrow({
      where: {
        id: reservationId,
      },
    });
  });
};

// Expires overdue active reservations and restores their stock.
export const expireReservations = async () => {
  return runSerializableTransaction(async (tx) => {
    const now = new Date();

    const expiredReservations = await tx.inventoryReservation.findMany({
      where: {
        status: "ACTIVE",
        expiresAt: {
          lte: now,
        },
      },
      select: {
        id: true,
        productId: true,
        quantity: true,
      },
      orderBy: {
        expiresAt: "asc",
      },
    });

    let expiredCount = 0;

    for (const reservation of expiredReservations) {
      const updated = await tx.inventoryReservation.updateMany({
        where: {
          id: reservation.id,
          status: "ACTIVE",
          expiresAt: {
            lte: now,
          },
        },
        data: {
          status: "EXPIRED",
        },
      });

      if (updated.count !== 1) {
        continue;
      }

      await tx.product.update({
        where: {
          id: reservation.productId,
        },
        data: {
          stock: {
            increment: reservation.quantity,
          },
        },
      });

      expiredCount += 1;
    }

    return {
      expiredCount,
    };
  });
};
