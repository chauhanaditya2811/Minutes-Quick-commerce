import { randomUUID } from "node:crypto";
import { prisma } from "../../src/config/database.js";

// Isolated rows in minutes_test for one test file. Every name is unique, so files can run in parallel.
export const createInventoryFixture = async () => {
  const [database] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (database?.name !== "minutes_test") {
    throw new Error("Inventory tests must connect to minutes_test.");
  }

  const tag = randomUUID().slice(0, 8);
  const ids = {
    users: [] as string[],
    hostels: [] as string[],
    products: [] as string[],
    orders: [] as string[],
    events: [] as string[],
  };

  await prisma.setting.upsert({
    where: { id: "store-settings" },
    create: { id: "store-settings", storeOpen: true, deliveryFee: 5, minimumOrder: 0 },
    update: { storeOpen: true, minimumOrder: 0 },
  });

  // Each hostel gets its own stock group, as in production; tests can then share one.
  const hostel = async (name: string, stockGroupId?: string) => {
    const row = await prisma.hostel.create({
      data: {
        name: `${name} ${tag}`,
        stockGroup: stockGroupId ? { connect: { id: stockGroupId } } : { create: { name: `${name} ${tag}` } },
      },
    });
    ids.hostels.push(row.id);
    return row;
  };

  const groupOf = async (hostelId: string) =>
    (await prisma.hostel.findUniqueOrThrow({ where: { id: hostelId }, select: { stockGroupId: true } })).stockGroupId;

  const product = async (name: string, price = 20) => {
    const row = await prisma.product.create({
      data: { name: `${name} ${tag}`, imageUrl: "https://example.test/p.jpg", price, unit: "pack" },
    });
    ids.products.push(row.id);
    return row;
  };

  const customer = async (hostelId: string) => {
    const id = randomUUID().slice(0, 12);
    const row = await prisma.user.create({
      data: {
        firebaseUid: `inv-${tag}-${id}`,
        email: `inv-${tag}-${id}@example.test`,
        name: "Inventory Test",
        phone: "9876543210",
        hostelId,
        floor: "1",
        room: "101",
      },
    });
    ids.users.push(row.id);
    return row;
  };

  // Stock is per stock group; these take a hostel and use whichever group it sells from.
  const setStock = async (productId: string, hostelId: string, quantity: number, isAvailable = true) => {
    const stockGroupId = await groupOf(hostelId);
    return prisma.productInventory.upsert({
      where: { productId_stockGroupId: { productId, stockGroupId } },
      create: { productId, stockGroupId, quantity, isAvailable },
      update: { quantity, isAvailable },
    });
  };

  const stock = async (productId: string, hostelId: string) => {
    const stockGroupId = await groupOf(hostelId);
    return (await prisma.productInventory.findUnique({ where: { productId_stockGroupId: { productId, stockGroupId } } }))?.quantity ?? null;
  };

  // A bare PENDING_PAYMENT order, for service-level tests that don't go through checkout.
  const pendingOrder = async (userId: string, hostelId: string | null, items: { productId: string; quantity: number }[]) => {
    const row = await prisma.order.create({
      data: {
        orderNumber: `MIN-TEST-${tag}-${randomUUID().slice(0, 8)}`,
        userId,
        hostelId,
        subtotal: 20,
        deliveryFee: 0,
        total: 20,
        paymentStatus: "PENDING",
        orderStatus: "PENDING_PAYMENT",
        customerName: "Inventory Test",
        customerEmail: "inv@example.test",
        customerPhone: "9876543210",
        customerHostel: "Test",
        customerFloor: "1",
        customerRoom: "101",
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            productName: "Test",
            price: 20,
            unit: "pack",
            quantity: item.quantity,
            subtotal: 20 * item.quantity,
          })),
        },
        paymentAttempts: { create: { amount: 20, status: "PENDING" } },
      },
      include: { items: true, paymentAttempts: true },
    });
    ids.orders.push(row.id);
    return row;
  };

  const trackOrder = (orderId: string) => ids.orders.push(orderId);

  const cleanup = async () => {
    const userOrders = await prisma.order.findMany({ where: { userId: { in: ids.users } }, select: { id: true } });
    const orderIds = [...new Set([...ids.orders, ...userOrders.map((o) => o.id)])];
    await prisma.inventoryReservation.deleteMany({
      where: { OR: [{ orderId: { in: orderIds } }, { userId: { in: ids.users } }] },
    });
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.cashfreeWebhookEvent.deleteMany({ where: { eventId: { in: ids.events } } });
    await prisma.productInventory.deleteMany({ where: { productId: { in: ids.products } } });
    await prisma.product.deleteMany({ where: { id: { in: ids.products } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    const groups = await prisma.hostel.findMany({ where: { id: { in: ids.hostels } }, select: { stockGroupId: true } });
    await prisma.hostel.deleteMany({ where: { id: { in: ids.hostels } } });
    await prisma.stockGroup.deleteMany({ where: { OR: [{ id: { in: groups.map((g) => g.stockGroupId) } }, { name: { endsWith: tag } }] } });
  };

  return { tag, ids, hostel, groupOf, product, customer, setStock, stock, pendingOrder, trackOrder, cleanup };
};
