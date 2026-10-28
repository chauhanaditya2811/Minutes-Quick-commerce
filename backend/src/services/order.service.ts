import { randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../config/database.js";
import {
  InventoryReservationError,
  consumeOrderReservations,
  releaseUserPendingReservations,
  reservationExpiry,
  reserveOrderStock,
} from "./inventory.service.js";

const SETTINGS_ID = "store-settings";
const MAX_ORDER_AMOUNT = 2_147_483_647;

export interface CheckoutItemInput {
  productId: string;
  quantity: number;
}

type CheckoutClient = Pick<
  Prisma.TransactionClient,
  "user" | "hostel" | "setting" | "productInventory"
>;

export interface CheckoutInput {
  hostelId: unknown;
  items: unknown;
}

export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseCheckoutItems = (items: unknown): CheckoutItemInput[] => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new CheckoutError("Your cart is empty.", 400);
  }

  if (items.length > 50) {
    throw new CheckoutError("Your cart contains too many items.", 400);
  }

  const seenProductIds = new Set<string>();
  const parsedItems: CheckoutItemInput[] = [];

  for (const item of items) {
    if (
      !isRecord(item) ||
      typeof item.productId !== "string" ||
      !item.productId.trim() ||
      typeof item.quantity !== "number" ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 100
    ) {
      throw new CheckoutError("One or more cart items are invalid.", 400);
    }

    if (seenProductIds.has(item.productId)) {
      throw new CheckoutError(
        "Your cart contains a duplicate product.",
        400
      );
    }

    seenProductIds.add(item.productId);
    parsedItems.push({
      productId: item.productId,
      quantity: item.quantity,
    });
  }

  return parsedItems;
};

const parseCheckoutHostelId = (hostelId: unknown): string => {
  if (typeof hostelId !== "string" || !hostelId.trim()) {
    throw new CheckoutError("Select a hostel before checkout.", 400);
  }

  return hostelId.trim();
};

const validateCheckoutWithClient = async (
  client: CheckoutClient,
  firebaseUid: string,
  input: CheckoutInput
) => {
  const storeHostelId = parseCheckoutHostelId(input.hostelId);
  const items = parseCheckoutItems(input.items);

  const user = await client.user.findUnique({
    where: { firebaseUid },
  });

  if (
    !user ||
    !user.name?.trim() ||
    !user.phone?.trim() ||
    !user.hostelId ||
    user.floor === null ||
    !Number.isInteger(user.floor) ||
    user.floor < 0 ||
    !user.room?.trim()
  ) {
    throw new CheckoutError(
      "Please complete your customer profile before checkout.",
      400
    );
  }

  const hostel = await client.hostel.findUnique({ where: { id: user.hostelId } });
  if (!hostel || !hostel.isActive) {
    throw new CheckoutError("Your hostel is inactive or no longer available. Please update your profile.", 400);
  }

  // Orders are fulfilled from the delivery hostel's own stock, so the store the
  // customer browsed must be the hostel saved in their delivery details.
  if (storeHostelId !== hostel.id) {
    const storeHostel = await client.hostel.findUnique({ where: { id: storeHostelId } });
    if (!storeHostel || !storeHostel.isActive) {
      throw new CheckoutError("The selected hostel is no longer available. Please choose another hostel.", 409);
    }
    throw new CheckoutError(
      `Your delivery details are for ${hostel.name}, but you are shopping at ${storeHostel.name}. Update your delivery hostel or switch store.`,
      409
    );
  }

  const settings = await client.setting.findUnique({
    where: { id: SETTINGS_ID },
  });

  if (!settings) {
    throw new CheckoutError("Store settings are not configured.", 503);
  }

  if (!settings.storeOpen) {
    throw new CheckoutError("The store is currently closed.", 409);
  }

  if (
    !Number.isSafeInteger(settings.deliveryFee) ||
    settings.deliveryFee < 0 ||
    settings.deliveryFee > MAX_ORDER_AMOUNT ||
    !Number.isSafeInteger(settings.minimumOrder) ||
    settings.minimumOrder < 0 ||
    settings.minimumOrder > MAX_ORDER_AMOUNT
  ) {
    throw new CheckoutError("Store settings are invalid.", 503);
  }

  const inventories = await client.productInventory.findMany({
    where: {
      hostelId: hostel.id,
      productId: { in: items.map(({ productId }) => productId) },
      isAvailable: true,
      product: { isDeleted: false },
    },
    select: {
      quantity: true,
      product: {
        select: {
          id: true,
          name: true,
          price: true,
          unit: true,
        },
      },
    },
  });
  const products = inventories.map(({ quantity, product }) => ({
    ...product,
    stock: quantity,
  }));

  if (products.length !== items.length) {
    throw new CheckoutError(
      `One or more products are no longer available at ${hostel.name}.`,
      409
    );
  }

  const productsById = new Map(products.map((product) => [product.id, product]));
  const orderItems = items.map(({ productId, quantity }) => {
    const product = productsById.get(productId);

    if (!product) {
      throw new CheckoutError(
        "One or more products are no longer available.",
        409
      );
    }

    if (product.stock <= 0) {
      throw new CheckoutError(`${product.name} is out of stock.`, 409);
    }

    if (quantity > product.stock) {
      throw new CheckoutError(
        `Only ${product.stock} unit(s) of ${product.name} are available.`,
        409
      );
    }

    const itemSubtotal = product.price * quantity;
    if (
      !Number.isSafeInteger(product.price) ||
      product.price < 0 ||
      !Number.isSafeInteger(itemSubtotal) ||
      itemSubtotal > MAX_ORDER_AMOUNT
    ) {
      throw new CheckoutError("The cart total is too large.", 400);
    }

    return {
      productId: product.id,
      productName: product.name,
      price: product.price,
      unit: product.unit,
      quantity,
      subtotal: itemSubtotal,
    };
  });

  const subtotal = orderItems.reduce((sum, item) => sum + item.subtotal, 0);
  const total = subtotal + settings.deliveryFee;

  if (
    !Number.isSafeInteger(subtotal) ||
    subtotal > MAX_ORDER_AMOUNT ||
    !Number.isSafeInteger(total) ||
    total > MAX_ORDER_AMOUNT
  ) {
    throw new CheckoutError("The order total is too large.", 400);
  }

  if (subtotal < settings.minimumOrder) {
    throw new CheckoutError(
      `Your order must be at least ₹${settings.minimumOrder} before delivery fees.`,
      409
    );
  }

  return {
    hostelId: hostel.id,
    customer: {
      id: user.id,
      name: user.name.trim(),
      email: user.email,
      image: user.profileImage,
      phone: user.phone.trim(),
      hostel: hostel.name,
      floor: user.floor,
      room: user.room.trim(),
    },
    items: orderItems,
    subtotal,
    deliveryFee: settings.deliveryFee,
    total,
  };
};

export const validateCheckout = (
  firebaseUid: string,
  input: CheckoutInput
) => validateCheckoutWithClient(prisma, firebaseUid, input);

// Creates the order and holds its stock at the order's hostel in one transaction:
// either both happen or neither does.
export const createOrder = async (firebaseUid: string, input: CheckoutInput) =>
  prisma.$transaction(async (tx) => {
    // Free this customer's holds on earlier unpaid orders first, so an abandoned
    // checkout never blocks their own new order.
    const customer = await tx.user.findUnique({ where: { firebaseUid }, select: { id: true } });
    if (customer) await releaseUserPendingReservations(tx, customer.id);

    const checkout = await validateCheckoutWithClient(tx, firebaseUid, input);

    const order = await tx.order.create({
      data: {
        orderNumber: `MIN-${randomUUID().replaceAll("-", "").toUpperCase()}`,
        userId: checkout.customer.id,
        hostelId: checkout.hostelId,
        subtotal: checkout.subtotal,
        deliveryFee: checkout.deliveryFee,
        total: checkout.total,
        paymentStatus: "PENDING",
        orderStatus: "PENDING_PAYMENT",
        customerName: checkout.customer.name,
        customerEmail: checkout.customer.email,
        customerImage: checkout.customer.image,
        customerPhone: checkout.customer.phone,
        customerHostel: checkout.customer.hostel,
        customerFloor: checkout.customer.floor,
        customerRoom: checkout.customer.room,
        items: {
          create: checkout.items,
        },
        paymentAttempts: {
          create: {
            amount: checkout.total,
            status: "PENDING",
          },
        },
      },
      include: {
        items: true,
        paymentAttempts: true,
      },
    });

    const holdExpiresAt = reservationExpiry();
    try {
      await reserveOrderStock(tx, {
        userId: checkout.customer.id,
        orderId: order.id,
        hostelId: checkout.hostelId,
        items: checkout.items.map(({ productId, productName, quantity }) => ({ productId, productName, quantity })),
        expiresAt: holdExpiresAt,
      });
    } catch (error) {
      if (error instanceof InventoryReservationError) {
        throw new CheckoutError(error.message, error.statusCode);
      }
      throw error;
    }

    return { ...order, holdExpiresAt };
  });

export const getCustomerOrders = (firebaseUid: string) =>
  prisma.order.findMany({
    where: {
      user: { firebaseUid },
    },
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

const adminOrderSelection = {
  id: true,
  orderNumber: true,
  customerName: true,
  customerEmail: true,
  customerPhone: true,
  customerHostel: true,
  customerFloor: true,
  customerRoom: true,
  inventoryShortfall: true,
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
} as const;

export class OrderManagementError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = "OrderManagementError";
  }
}

export const getAdminOrders = () =>
  prisma.order.findMany({
    select: adminOrderSelection,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

export const markOrderDelivered = async (orderId: string) => {
  const updated = await prisma.order.updateMany({
    where: {
      id: orderId,
      orderStatus: "CONFIRMED",
      paymentStatus: "SUCCESS",
    },
    data: {
      orderStatus: "DELIVERED",
      deliveredAt: new Date(),
    },
  });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: adminOrderSelection,
  });

  if (!order) {
    throw new OrderManagementError("Order not found.", 404);
  }

  const wasAlreadyDelivered =
    order.orderStatus === "DELIVERED" && order.paymentStatus === "SUCCESS";
  if (updated.count === 0 && !wasAlreadyDelivered) {
    throw new OrderManagementError(
      "Only confirmed, successfully paid orders can be marked as delivered.",
      409
    );
  }

  return order;
};

const getOrderForPaymentTransition = (
  tx: Prisma.TransactionClient,
  orderId: string
) =>
  tx.order.findUnique({
    where: { id: orderId },
    include: { items: true, paymentAttempts: true },
  });

export interface VerifiedPayment {
  orderId: string;
  attemptId: string;
  cashfreeOrderId: string;
  cashfreePaymentId: string;
  amount: number;
}

/**
 * Confirms an order whose payment the provider has independently verified, and finalises its
 * stock. Shared by payment verification and the webhook. Idempotent: the conditional update lets
 * exactly one caller confirm the order; any other (a retry, a duplicate webhook, or verification
 * racing the webhook) waits on the row lock, sees it already confirmed, and changes nothing.
 */
export const finalizePaidOrder = async (tx: Prisma.TransactionClient, payment: VerifiedPayment) => {
  const updated = await tx.order.updateMany({
    where: { id: payment.orderId, orderStatus: "PENDING_PAYMENT" },
    data: { paymentStatus: "SUCCESS", orderStatus: "CONFIRMED" },
  });
  const order = await tx.order.findUnique({ where: { id: payment.orderId }, include: { items: true } });
  if (!order) throw new CheckoutError("Order not found.", 404);

  if (updated.count === 0) {
    if (order.paymentStatus === "SUCCESS" && ["CONFIRMED", "DELIVERED"].includes(order.orderStatus)) {
      return { order, newlyConfirmed: false, shortfall: false };
    }
    throw new CheckoutError("The order is not eligible for payment confirmation.", 409);
  }

  const { shortfall } = await consumeOrderReservations(tx, {
    id: order.id,
    userId: order.userId,
    hostelId: order.hostelId,
    items: order.items.map(({ productId, quantity }) => ({ productId, quantity })),
  });
  if (shortfall) {
    await tx.order.update({ where: { id: order.id }, data: { inventoryShortfall: true } });
  }

  await tx.paymentAttempt.update({
    where: { id: payment.attemptId },
    data: { status: "SUCCESS", cashfreePaymentId: payment.cashfreePaymentId, provider: "CASHFREE" },
  });
  const paymentData = {
    cashfreeOrderId: payment.cashfreeOrderId,
    cashfreePaymentId: payment.cashfreePaymentId,
    amount: payment.amount,
    status: "SUCCESS" as const,
    provider: "CASHFREE" as const,
  };
  await tx.payment.upsert({
    where: { orderId: order.id },
    create: { orderId: order.id, ...paymentData },
    update: paymentData,
  });

  return { order: { ...order, inventoryShortfall: shortfall }, newlyConfirmed: true, shortfall };
};

/**
 * Records a failed payment attempt without ever overwriting a success that committed first.
 * Stock stays held: the customer can retry until the hold expires.
 */
export const recordFailedPaymentAttempt = async (
  tx: Prisma.TransactionClient,
  failure: { orderId: string; attemptId: string; cashfreePaymentId: string }
) => {
  await tx.paymentAttempt.updateMany({
    where: { id: failure.attemptId, status: { not: "SUCCESS" } },
    data: { status: "FAILED", cashfreePaymentId: failure.cashfreePaymentId, provider: "CASHFREE" },
  });
  await tx.order.updateMany({
    where: { id: failure.orderId, orderStatus: "PENDING_PAYMENT", paymentStatus: { not: "SUCCESS" } },
    data: { paymentStatus: "FAILED" },
  });
};

export const markOrderPaymentFailed = async (orderId: string) =>
  prisma.$transaction(async (tx) => {
    await tx.order.updateMany({
      where: {
        id: orderId,
        orderStatus: "PENDING_PAYMENT",
        paymentStatus: { in: ["CREATED", "PENDING"] },
      },
      data: { paymentStatus: "FAILED" },
    });

    await tx.paymentAttempt.updateMany({
      where: {
        orderId,
        status: { in: ["CREATED", "PENDING"] },
      },
      data: { status: "FAILED" },
    });

    const order = await getOrderForPaymentTransition(tx, orderId);
    if (
      order?.orderStatus === "PENDING_PAYMENT" &&
      ["PENDING", "FAILED"].includes(order.paymentStatus)
    ) {
      return order;
    }

    if (
      order?.paymentStatus === "SUCCESS" &&
      ["CONFIRMED", "DELIVERED"].includes(order.orderStatus)
    ) {
      return order;
    }

    throw new CheckoutError("Order is not eligible for payment failure.", 409);
  });
