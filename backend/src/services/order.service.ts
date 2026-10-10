import { randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../config/database.js";

const SETTINGS_ID = "store-settings";
const MAX_ORDER_AMOUNT = 2_147_483_647;

export interface CheckoutItemInput {
  productId: string;
  quantity: number;
}

type CheckoutClient = Pick<
  Prisma.TransactionClient,
  "user" | "setting" | "product"
>;

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

const validateCheckoutWithClient = async (
  client: CheckoutClient,
  firebaseUid: string,
  input: unknown
) => {
  const items = parseCheckoutItems(input);

  const user = await client.user.findUnique({
    where: { firebaseUid },
  });

  if (
    !user ||
    !user.name?.trim() ||
    !user.phone?.trim() ||
    !user.hostel?.trim() ||
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

  const products = await client.product.findMany({
    where: {
      id: { in: items.map(({ productId }) => productId) },
      isDeleted: false,
    },
    select: {
      id: true,
      name: true,
      price: true,
      unit: true,
      stock: true,
    },
  });

  if (products.length !== items.length) {
    throw new CheckoutError(
      "One or more products are no longer available.",
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
    customer: {
      id: user.id,
      name: user.name.trim(),
      email: user.email,
      image: user.profileImage,
      phone: user.phone.trim(),
      hostel: user.hostel.trim(),
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
  items: unknown
) => validateCheckoutWithClient(prisma, firebaseUid, items);

export const createOrder = async (firebaseUid: string, input: unknown) =>
  prisma.$transaction(async (tx) => {
    const checkout = await validateCheckoutWithClient(
      tx,
      firebaseUid,
      isRecord(input) ? input.items : input
    );

    return tx.order.create({
      data: {
        orderNumber: `MIN-${randomUUID().replaceAll("-", "").toUpperCase()}`,
        userId: checkout.customer.id,
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
  });

const getOrderForPaymentTransition = (
  tx: Prisma.TransactionClient,
  orderId: string
) =>
  tx.order.findUnique({
    where: { id: orderId },
    include: { items: true, paymentAttempts: true },
  });

// Call only after a payment provider has independently verified success.
export const confirmOrderPaymentAfterVerification = async (
  orderId: string
) =>
  prisma.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: {
        id: orderId,
        orderStatus: "PENDING_PAYMENT",
        paymentStatus: { in: ["CREATED", "PENDING", "FAILED"] },
      },
      data: {
        paymentStatus: "SUCCESS",
        orderStatus: "CONFIRMED",
      },
    });

    if (updated.count > 0) {
      await tx.paymentAttempt.updateMany({
        where: {
          orderId,
          status: { in: ["CREATED", "PENDING", "FAILED"] },
        },
        data: { status: "SUCCESS" },
      });
    }

    const order = await getOrderForPaymentTransition(tx, orderId);
    if (
      order?.paymentStatus === "SUCCESS" &&
      ["CONFIRMED", "DELIVERED"].includes(order.orderStatus)
    ) {
      return order;
    }

    throw new CheckoutError(
      "Order is not eligible for payment confirmation.",
      409
    );
  });

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
