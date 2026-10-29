
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  hostelFindUnique: vi.fn(),
  settingFindUnique: vi.fn(),
  inventoryFindMany: vi.fn(),
  orderCreate: vi.fn(),
  orderFindMany: vi.fn(),
  orderUpdateMany: vi.fn(),
  orderFindUnique: vi.fn(),
  paymentAttemptUpdateMany: vi.fn(),
  transaction: vi.fn(),
  orderUpdate: vi.fn(),
  paymentAttemptUpdate: vi.fn(),
  paymentUpsert: vi.fn(),
  reserveStock: vi.fn(),
  releaseUserHolds: vi.fn(),
  consumeHolds: vi.fn(),
}));

// Real stock behaviour is covered against a database in tests/inventory.
vi.mock("../src/services/inventory.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/inventory.service.js")>()),
  reserveOrderStock: mocks.reserveStock,
  releaseUserPendingReservations: mocks.releaseUserHolds,
  consumeOrderReservations: mocks.consumeHolds,
}));

// Mock Prisma so these tests never write to the real database.
vi.mock("../src/config/database.js", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    hostel: { findUnique: mocks.hostelFindUnique },
    setting: { findUnique: mocks.settingFindUnique },
    productInventory: { findMany: mocks.inventoryFindMany },
    order: {
      create: mocks.orderCreate,
      findMany: mocks.orderFindMany,
      updateMany: mocks.orderUpdateMany,
      findUnique: mocks.orderFindUnique,
    },
    paymentAttempt: { updateMany: mocks.paymentAttemptUpdateMany },
    $transaction: mocks.transaction,
  },
}));

import { InventoryReservationError } from "../src/services/inventory.service.js";
import {
  finalizePaidOrder,
  createOrder,
  getAdminOrders,
  getCustomerOrders,
  markOrderDelivered,
  markOrderPaymentFailed,
  OrderManagementError,
  validateCheckout,
} from "../src/services/order.service.js";

const customer = {
  id: "user-1",
  firebaseUid: "firebase-user-1",
  email: "student@example.com",
  name: "Test Student",
  profileImage: null,
  phone: "9876543210",
  hostelId: "hostel-1",
  floor: 2,
  room: "204",
};

const hostel = { id: "hostel-1", name: "Hostel A", isActive: true };

const settings = {
  id: "store-settings",
  storeOpen: true,
  deliveryFee: 20,
  minimumOrder: 100,
  supportEmail: null,
  updatedAt: new Date(),
};

const water = {
  id: "product-1",
  name: "Water",
  price: 30,
  unit: "bottle",
};

// Hostel inventory row as selected by checkout validation.
const waterAtHostel = (quantity: number) => ({ quantity, product: water });

const checkoutFor = (items: unknown, hostelId: unknown = "hostel-1") => ({
  hostelId,
  items,
});

describe("checkout validation service", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          user: { findUnique: mocks.userFindUnique },
          hostel: { findUnique: mocks.hostelFindUnique },
          setting: { findUnique: mocks.settingFindUnique },
          productInventory: { findMany: mocks.inventoryFindMany },
          order: {
            create: mocks.orderCreate,
            findMany: mocks.orderFindMany,
            updateMany: mocks.orderUpdateMany,
            findUnique: mocks.orderFindUnique,
          },
          paymentAttempt: { updateMany: mocks.paymentAttemptUpdateMany },
        })
    );
    mocks.userFindUnique.mockResolvedValue(customer);
    mocks.hostelFindUnique.mockResolvedValue(hostel);
    mocks.settingFindUnique.mockResolvedValue(settings);
    mocks.inventoryFindMany.mockResolvedValue([waterAtHostel(10)]);
    mocks.orderCreate.mockResolvedValue({ id: "order-1" });
    mocks.orderUpdateMany.mockResolvedValue({ count: 1 });
    mocks.orderFindUnique.mockResolvedValue({
      id: "order-1",
      paymentStatus: "SUCCESS",
      orderStatus: "CONFIRMED",
      items: [],
      paymentAttempts: [],
    });
    mocks.paymentAttemptUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("calculates subtotal and delivery fee using database prices", async () => {
    const result = await validateCheckout("firebase-user-1", checkoutFor([
      { productId: "product-1", quantity: 4 },
    ]));

    expect(result.subtotal).toBe(120);
    expect(result.deliveryFee).toBe(20);
    expect(result.total).toBe(140);

    expect(result.items).toEqual([
      {
        productId: "product-1",
        productName: "Water",
        price: 30,
        unit: "bottle",
        quantity: 4,
        subtotal: 120,
      },
    ]);

    expect(result.hostelId).toBe("hostel-1");
    expect(mocks.inventoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          hostelId: "hostel-1",
          productId: { in: ["product-1"] },
          isAvailable: true,
          product: { isDeleted: false },
        },
      })
    );
  });

  it("rejects an empty cart", async () => {
    await expect(
      validateCheckout("firebase-user-1", checkoutFor([]))
    ).rejects.toThrow("Your cart is empty.");
  });

  it("rejects duplicate product IDs", async () => {
    await expect(
      validateCheckout("firebase-user-1", checkoutFor([
        { productId: "product-1", quantity: 1 },
        { productId: "product-1", quantity: 2 },
      ]))
    ).rejects.toThrow("Your cart contains a duplicate product.");
  });

  it("rejects invalid quantities", async () => {
    await expect(
      validateCheckout("firebase-user-1", checkoutFor([
        { productId: "product-1", quantity: 0 },
      ]))
    ).rejects.toThrow("One or more cart items are invalid.");
  });

  it("rejects checkout when the customer profile is missing", async () => {
    mocks.userFindUnique.mockResolvedValue(null);

    await expect(
      validateCheckout("firebase-user-1", checkoutFor([
        { productId: "product-1", quantity: 4 },
      ]))
    ).rejects.toThrow(
      "Please complete your customer profile before checkout."
    );
  });

  it("rejects checkout when no hostel is assigned", async () => {
    mocks.userFindUnique.mockResolvedValue({ ...customer, hostelId: null });
    await expect(validateCheckout("firebase-user-1", checkoutFor([{ productId: "product-1", quantity: 1 }]))).rejects.toThrow("Please complete your customer profile before checkout.");
  });

  it("rejects checkout when the selected hostel is inactive", async () => {
    mocks.hostelFindUnique.mockResolvedValue({ ...hostel, isActive: false });
    await expect(validateCheckout("firebase-user-1", checkoutFor([{ productId: "product-1", quantity: 1 }]))).rejects.toThrow("Your hostel is inactive or no longer available.");
  });

  it("rejects checkout when the store is closed", async () => {
    mocks.settingFindUnique.mockResolvedValue({
      ...settings,
      storeOpen: false,
    });

    await expect(
      validateCheckout("firebase-user-1", checkoutFor([
        { productId: "product-1", quantity: 4 },
      ]))
    ).rejects.toThrow("The store is currently closed.");
  });

  it("rejects products that are out of stock", async () => {
    mocks.inventoryFindMany.mockResolvedValue([waterAtHostel(0)]);

    await expect(
      validateCheckout("firebase-user-1", checkoutFor([
        { productId: "product-1", quantity: 1 },
      ]))
    ).rejects.toThrow("Water is out of stock.");
  });

  it("rejects quantities above the manually configured stock", async () => {
    mocks.inventoryFindMany.mockResolvedValue([waterAtHostel(2)]);

    await expect(
      validateCheckout("firebase-user-1", checkoutFor([
        { productId: "product-1", quantity: 3 },
      ]))
    ).rejects.toThrow(
      "Only 2 unit(s) of Water are available."
    );
  });

  it("enforces the minimum product subtotal before delivery fees", async () => {
    await expect(
      validateCheckout("firebase-user-1", checkoutFor([
        { productId: "product-1", quantity: 3 },
      ]))
    ).rejects.toThrow(
      "Your order must be at least ₹100 before delivery fees."
    );
  });

  it("rejects products that have been deleted", async () => {
    mocks.inventoryFindMany.mockResolvedValue([]);

    await expect(
      validateCheckout("firebase-user-1", checkoutFor([
        { productId: "product-1", quantity: 1 },
      ]))
    ).rejects.toThrow(
      "One or more products are no longer available at Hostel A."
    );
  });

  it("requires a selected store hostel", async () => {
    await expect(
      validateCheckout("firebase-user-1", { hostelId: undefined, items: [{ productId: "product-1", quantity: 4 }] })
    ).rejects.toMatchObject({ statusCode: 400, message: "Select a hostel before checkout." });
    expect(mocks.inventoryFindMany).not.toHaveBeenCalled();
  });

  it("rejects a store hostel that differs from the delivery hostel", async () => {
    mocks.hostelFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "hostel-2" ? { id: "hostel-2", name: "Hostel B", isActive: true } : hostel
    );

    await expect(
      validateCheckout("firebase-user-1", checkoutFor([{ productId: "product-1", quantity: 4 }], "hostel-2"))
    ).rejects.toMatchObject({
      statusCode: 409,
      message:
        "Your delivery details are for Hostel A, but you are shopping at Hostel B. Update your delivery hostel or switch store.",
    });
    expect(mocks.inventoryFindMany).not.toHaveBeenCalled();
  });

  it("rejects an inactive or unknown store hostel", async () => {
    mocks.hostelFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "hostel-1" ? hostel : null
    );

    await expect(
      validateCheckout("firebase-user-1", checkoutFor([{ productId: "product-1", quantity: 4 }], "missing"))
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("does not create an order for a different hostel than the delivery hostel", async () => {
    mocks.hostelFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "hostel-2" ? { id: "hostel-2", name: "Hostel B", isActive: true } : hostel
    );

    await expect(
      createOrder("firebase-user-1", checkoutFor([{ productId: "product-1", quantity: 4 }], "hostel-2"))
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.orderCreate).not.toHaveBeenCalled();
  });

  it("creates a pending order with database-derived item and customer snapshots", async () => {
    await createOrder("firebase-user-1", {
      hostelId: "hostel-1",
      items: [{ productId: "product-1", quantity: 4 }],
    });

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.orderCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        hostelId: "hostel-1",
        subtotal: 120,
        deliveryFee: 20,
        total: 140,
        paymentStatus: "PENDING",
        orderStatus: "PENDING_PAYMENT",
        customerName: "Test Student",
        customerPhone: "9876543210",
        customerHostel: "Hostel A",
        customerFloor: 2,
        customerRoom: "204",
        items: {
          create: [
            {
              productId: "product-1",
              productName: "Water",
              price: 30,
              unit: "bottle",
              quantity: 4,
              subtotal: 120,
            },
          ],
        },
        paymentAttempts: {
          create: { amount: 140, status: "PENDING" },
        },
      }),
      include: { items: true, paymentAttempts: true },
    });
    expect(mocks.releaseUserHolds).toHaveBeenCalledWith(expect.anything(), "user-1");
    expect(mocks.reserveStock).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      orderId: "order-1",
      hostelId: "hostel-1",
      items: [{ productId: "product-1", productName: "Water", quantity: 4 }],
      expiresAt: expect.any(Date),
    });
  });

  it("rejects the order when another customer took the stock first", async () => {
    mocks.reserveStock.mockRejectedValue(
      new InventoryReservationError("Water is no longer available in the quantity you selected.")
    );

    await expect(
      createOrder("firebase-user-1", checkoutFor([{ productId: "product-1", quantity: 4 }]))
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Water is no longer available in the quantity you selected.",
    });
  });

  it("returns only the authenticated customer's orders newest first", async () => {
    const orders = [{ id: "order-1" }];
    mocks.orderFindMany.mockResolvedValue(orders);

    await expect(getCustomerOrders("firebase-customer-a")).resolves.toBe(orders);

    expect(mocks.orderFindMany).toHaveBeenCalledWith({
      where: { user: { firebaseUid: "firebase-customer-a" } },
      select: {
        orderNumber: true,
        createdAt: true,
        orderStatus: true,
        paymentStatus: true,
        subtotal: true,
        deliveryFee: true,
        total: true,
        items: {
          select: {
            productName: true,
            price: true,
            unit: true,
            quantity: true,
            subtotal: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("lists bounded admin order details newest first from historical snapshots", async () => {
    mocks.orderFindMany.mockResolvedValue([]);

    await expect(getAdminOrders()).resolves.toEqual([]);

    const query = mocks.orderFindMany.mock.calls[0][0];
    expect(query).toMatchObject({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        orderNumber: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        customerHostel: true,
        customerFloor: true,
        customerRoom: true,
        subtotal: true,
        deliveryFee: true,
        total: true,
        paymentStatus: true,
        orderStatus: true,
        createdAt: true,
        deliveredAt: true,
        items: {
          select: {
            productName: true,
            price: true,
            unit: true,
            quantity: true,
            subtotal: true,
          },
        },
      },
    });
    // Only the Cashfree transaction references are exposed, never the full payment row.
    expect(query.select.payment).toEqual({ select: { cashfreeOrderId: true, cashfreePaymentId: true } });
    expect(query.select.userId).toBe(true);
    expect(query.select).not.toHaveProperty("paymentAttempts");
    expect(query.select).not.toHaveProperty("user");
    expect(query.select).not.toHaveProperty("guestAccessTokenHash");
  });

  it("marks only successfully paid confirmed orders delivered and sets deliveredAt", async () => {
    const before = Date.now();
    mocks.orderFindUnique.mockResolvedValue({
      id: "order-1",
      orderStatus: "DELIVERED",
      paymentStatus: "SUCCESS",
      deliveredAt: new Date(),
    });

    const order = await markOrderDelivered("order-1");

    expect(mocks.orderUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "order-1",
        orderStatus: "CONFIRMED",
        paymentStatus: "SUCCESS",
      },
      data: {
        orderStatus: "DELIVERED",
        deliveredAt: expect.any(Date),
      },
    });
    const deliveredAt = mocks.orderUpdateMany.mock.calls[0][0].data
      .deliveredAt as Date;
    expect(deliveredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(order.orderStatus).toBe("DELIVERED");
  });

  it.each([
    ["unpaid pending order", "PENDING_PAYMENT", "PENDING"],
    ["failed payment", "PENDING_PAYMENT", "FAILED"],
    ["cancelled order", "CANCELLED", "SUCCESS"],
    ["failed payment on confirmed order", "CONFIRMED", "FAILED"],
  ])("does not deliver a %s", async (_description, orderStatus, paymentStatus) => {
    mocks.orderUpdateMany.mockResolvedValue({ count: 0 });
    mocks.orderFindUnique.mockResolvedValue({ orderStatus, paymentStatus });

    await expect(markOrderDelivered("order-1")).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mocks.orderUpdateMany).toHaveBeenCalledOnce();
  });

  it("returns an already delivered order idempotently", async () => {
    const deliveredOrder = {
      id: "order-1",
      orderStatus: "DELIVERED",
      paymentStatus: "SUCCESS",
      deliveredAt: new Date(),
    };
    mocks.orderUpdateMany.mockResolvedValue({ count: 0 });
    mocks.orderFindUnique.mockResolvedValue(deliveredOrder);

    await expect(markOrderDelivered("order-1")).resolves.toBe(deliveredOrder);
  });

  it("returns not found for a nonexistent delivery target", async () => {
    mocks.orderUpdateMany.mockResolvedValue({ count: 0 });
    mocks.orderFindUnique.mockResolvedValue(null);

    const result = markOrderDelivered("missing");
    await expect(result).rejects.toBeInstanceOf(OrderManagementError);
    await expect(result).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("runs order creation inside a transaction and propagates write failures", async () => {
    mocks.orderCreate.mockRejectedValue(new Error("write failed"));

    await expect(
      createOrder("firebase-user-1", checkoutFor([
        { productId: "product-1", quantity: 4 },
      ]))
    ).rejects.toThrow("write failed");

    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it("marks failed payments without confirming the order", async () => {
    mocks.orderUpdateMany.mockResolvedValue({ count: 1 });
    mocks.orderFindUnique.mockResolvedValue({
      id: "order-1",
      paymentStatus: "FAILED",
      orderStatus: "PENDING_PAYMENT",
      items: [],
      paymentAttempts: [],
    });

    const order = await markOrderPaymentFailed("order-1");

    expect(order.paymentStatus).toBe("FAILED");
    expect(order.orderStatus).toBe("PENDING_PAYMENT");
    expect(mocks.orderUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "order-1",
        orderStatus: "PENDING_PAYMENT",
        paymentStatus: { in: ["CREATED", "PENDING"] },
      },
      data: { paymentStatus: "FAILED" },
    });
  });

  describe("finalizePaidOrder", () => {
    const payment = {
      orderId: "order-1",
      attemptId: "attempt-1",
      cashfreeOrderId: "MIN-attempt-1",
      cashfreePaymentId: "cf-pay-1",
      amount: 140,
    };
    const paidTx = () => ({
      order: { updateMany: mocks.orderUpdateMany, findUnique: mocks.orderFindUnique, update: mocks.orderUpdate },
      paymentAttempt: { update: mocks.paymentAttemptUpdate },
      payment: { upsert: mocks.paymentUpsert },
    });
    const orderRow = (orderStatus: string, paymentStatus: string) => ({
      id: "order-1",
      userId: "user-1",
      hostelId: "hostel-1",
      orderStatus,
      paymentStatus,
      items: [{ productId: "product-1", quantity: 2 }],
    });

    beforeEach(() => {
      mocks.consumeHolds.mockResolvedValue({ shortfall: false });
    });

    it("confirms once, finalises the order's hostel stock and records the payment", async () => {
      mocks.orderUpdateMany.mockResolvedValue({ count: 1 });
      mocks.orderFindUnique.mockResolvedValue(orderRow("CONFIRMED", "SUCCESS"));

      const result = await finalizePaidOrder(paidTx() as never, payment);

      expect(result.newlyConfirmed).toBe(true);
      expect(mocks.orderUpdateMany).toHaveBeenCalledWith({
        where: { id: "order-1", orderStatus: "PENDING_PAYMENT" },
        data: { paymentStatus: "SUCCESS", orderStatus: "CONFIRMED", confirmedAt: expect.any(Date) },
      });
      expect(mocks.consumeHolds).toHaveBeenCalledWith(expect.anything(), {
        id: "order-1",
        userId: "user-1",
        hostelId: "hostel-1",
        items: [{ productId: "product-1", quantity: 2 }],
      });
      expect(mocks.paymentAttemptUpdate).toHaveBeenCalledWith({
        where: { id: "attempt-1" },
        data: { status: "SUCCESS", cashfreePaymentId: "cf-pay-1", provider: "CASHFREE" },
      });
      expect(mocks.paymentUpsert).toHaveBeenCalled();
      expect(mocks.orderUpdate).not.toHaveBeenCalled();
    });

    it("is idempotent: a repeated confirmation changes nothing and takes no stock", async () => {
      mocks.orderUpdateMany.mockResolvedValue({ count: 0 });
      mocks.orderFindUnique.mockResolvedValue(orderRow("CONFIRMED", "SUCCESS"));

      const result = await finalizePaidOrder(paidTx() as never, payment);

      expect(result).toMatchObject({ newlyConfirmed: false, shortfall: false });
      expect(mocks.consumeHolds).not.toHaveBeenCalled();
      expect(mocks.paymentAttemptUpdate).not.toHaveBeenCalled();
      expect(mocks.paymentUpsert).not.toHaveBeenCalled();
    });

    it("flags the order when the hostel no longer had enough stock", async () => {
      mocks.orderUpdateMany.mockResolvedValue({ count: 1 });
      mocks.orderFindUnique.mockResolvedValue(orderRow("CONFIRMED", "SUCCESS"));
      mocks.consumeHolds.mockResolvedValue({ shortfall: true });

      const result = await finalizePaidOrder(paidTx() as never, payment);

      expect(result.shortfall).toBe(true);
      expect(mocks.orderUpdate).toHaveBeenCalledWith({ where: { id: "order-1" }, data: { inventoryShortfall: true } });
    });

    it("rejects orders that are no longer payable", async () => {
      mocks.orderUpdateMany.mockResolvedValue({ count: 0 });
      mocks.orderFindUnique.mockResolvedValue(orderRow("CANCELLED", "FAILED"));

      await expect(finalizePaidOrder(paidTx() as never, payment)).rejects.toMatchObject({ statusCode: 409 });
      expect(mocks.consumeHolds).not.toHaveBeenCalled();
    });
  });
});
