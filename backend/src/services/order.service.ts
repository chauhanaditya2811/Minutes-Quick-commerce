import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../config/database.js";
import { BLOCK_FLOOR_MESSAGE, parseBlockFloor } from "../utils/blockFloor.js";
import {
  InventoryReservationError,
  consumeOrderReservations,
  releaseOrderReservations,
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

export interface GuestCheckoutInput extends CheckoutInput {
  customer: unknown;
}

export interface GuestOrderInput extends GuestCheckoutInput {
  checkoutToken: unknown;
  /** Optional { orderId, checkoutToken } of the guest's earlier unpaid order to release. */
  replacesOrder?: unknown;
}

export interface GuestCustomer {
  name: string;
  phone: string;
  /** Block and floor, e.g. "A/2". */
  floor: string;
  room: string;
}

// Same rules as the signed-in profile: Indian 10-digit mobile numbers starting 6-9.
const PHONE_PATTERN = /^[6-9]\d{9}$/;

const parseGuestCustomer = (input: unknown): GuestCustomer => {
  if (!isRecord(input)) {
    throw new CheckoutError("Enter your delivery details.", 400);
  }

  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 80) {
    throw new CheckoutError("Enter your full name (2 to 80 characters).", 400);
  }

  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  if (!PHONE_PATTERN.test(phone)) {
    throw new CheckoutError("Phone must be exactly 10 digits and start with 6-9.", 400);
  }

  const floor = parseBlockFloor(input.floor);
  if (floor === null) {
    throw new CheckoutError(BLOCK_FLOOR_MESSAGE, 400);
  }

  const room = typeof input.room === "string" ? input.room.trim() : "";
  if (!room || room.length > 20) {
    throw new CheckoutError("Enter your room number (up to 20 characters).", 400);
  }

  return { name, phone, floor, room };
};

// Guest checkout tokens are 256-bit random values generated in the browser (43+ base64url
// characters). Only their SHA-256 hash is stored, so a database leak does not expose them.
const GUEST_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

const isGuestToken = (value: unknown): value is string =>
  typeof value === "string" && GUEST_TOKEN_PATTERN.test(value);

export const hashGuestToken = (token: string) => createHash("sha256").update(token).digest("hex");

const parseGuestToken = (value: unknown): string => {
  if (!isGuestToken(value)) {
    throw new CheckoutError("This checkout session is invalid. Please refresh and try again.", 400);
  }
  return value;
};

// Loads and sanity-checks the store settings that every checkout depends on.
const loadStoreSettings = async (client: CheckoutClient) => {
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

  return settings;
};

// Prices a cart from the current stock of the hostel's stock group and the database prices.
// Client-supplied prices, fees and totals are never used: only product IDs and quantities are read.
const priceCartAtHostel = async (
  client: CheckoutClient,
  hostel: { id: string; name: string; stockGroupId: string },
  items: CheckoutItemInput[],
  settings: { deliveryFee: number; minimumOrder: number }
) => {
  const inventories = await client.productInventory.findMany({
    where: {
      stockGroupId: hostel.stockGroupId,
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

  return { items: orderItems, subtotal, deliveryFee: settings.deliveryFee, total };
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
    !user.floor?.trim() ||
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

  // Orders are fulfilled from the delivery hostel's stock group, so the store the customer
  // browsed must share that stock: the same hostel, or another hostel in the same group.
  if (storeHostelId !== hostel.id) {
    const storeHostel = await client.hostel.findUnique({ where: { id: storeHostelId } });
    if (!storeHostel || !storeHostel.isActive) {
      throw new CheckoutError("The selected hostel is no longer available. Please choose another hostel.", 409);
    }
    if (storeHostel.stockGroupId !== hostel.stockGroupId) throw new CheckoutError(
      `Your delivery details are for ${hostel.name}, but you are shopping at ${storeHostel.name}. Update your delivery hostel or switch store.`,
      409
    );
  }

  const settings = await loadStoreSettings(client);
  const priced = await priceCartAtHostel(client, hostel, items, settings);

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
    ...priced,
  };
};

// A guest delivers to the hostel they are shopping at, so its stock is the stock that is sold.
const validateGuestCheckoutWithClient = async (
  client: CheckoutClient,
  input: GuestCheckoutInput
) => {
  const hostelId = parseCheckoutHostelId(input.hostelId);
  const items = parseCheckoutItems(input.items);
  const customer = parseGuestCustomer(input.customer);

  const hostel = await client.hostel.findUnique({ where: { id: hostelId } });
  if (!hostel || !hostel.isActive) {
    throw new CheckoutError("The selected hostel is no longer available. Please choose another hostel.", 409);
  }

  const settings = await loadStoreSettings(client);
  const priced = await priceCartAtHostel(client, hostel, items, settings);

  return {
    hostelId: hostel.id,
    customer: {
      id: null,
      name: customer.name,
      email: null,
      image: null,
      phone: customer.phone,
      hostel: hostel.name,
      floor: customer.floor,
      room: customer.room,
    },
    ...priced,
  };
};

type ValidatedCheckout = Awaited<ReturnType<typeof validateCheckoutWithClient>> | Awaited<ReturnType<typeof validateGuestCheckoutWithClient>>;

export const validateCheckout = (
  firebaseUid: string,
  input: CheckoutInput
) => validateCheckoutWithClient(prisma, firebaseUid, input);

/** Server-priced summary for a guest cart. Nothing is stored. */
export const validateGuestCheckout = async (input: GuestCheckoutInput) => {
  const { customer, ...checkout } = await validateGuestCheckoutWithClient(prisma, input);
  const { id: _id, email: _email, image: _image, ...details } = customer;
  return { ...checkout, customer: details };
};

// Creates a PENDING_PAYMENT order with its first payment attempt and holds its stock at the
// order's hostel, inside the caller's transaction: either all of it happens or none of it.
const createPendingOrder = async (
  tx: Prisma.TransactionClient,
  checkout: ValidatedCheckout,
  owner: { userId: string | null; guestAccessTokenHash: string | null }
) => {
  const order = await tx.order.create({
    data: {
      orderNumber: `MIN-${randomUUID().replaceAll("-", "").toUpperCase()}`,
      userId: owner.userId,
      guestAccessTokenHash: owner.guestAccessTokenHash,
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
      userId: owner.userId,
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
};

// Creates the order and holds its stock at the order's hostel in one transaction:
// either both happen or neither does.
export const createOrder = async (firebaseUid: string, input: CheckoutInput) =>
  prisma.$transaction(async (tx) => {
    // Free this customer's holds on earlier unpaid orders first, so an abandoned
    // checkout never blocks their own new order.
    const customer = await tx.user.findUnique({ where: { firebaseUid }, select: { id: true } });
    if (customer) await releaseUserPendingReservations(tx, customer.id);

    const checkout = await validateCheckoutWithClient(tx, firebaseUid, input);
    return createPendingOrder(tx, checkout, { userId: checkout.customer.id, guestAccessTokenHash: null });
  });

// The order a guest token already created, if any. A token is single-use per cart:
// replaying it with the same cart returns the same order instead of creating another.
const findGuestOrderForReplay = async (tokenHash: string, hostelId: string, items: CheckoutItemInput[]) => {
  const existing = await prisma.order.findUnique({
    where: { guestAccessTokenHash: tokenHash },
    include: { items: true, paymentAttempts: true },
  });
  if (!existing) return null;

  const sameCart =
    existing.hostelId === hostelId &&
    existing.items.length === items.length &&
    items.every((item) => existing.items.some((line) => line.productId === item.productId && line.quantity === item.quantity));
  if (!sameCart) {
    throw new CheckoutError("This checkout was already used for a different cart. Please try again.", 409);
  }

  return { ...existing, holdExpiresAt: null };
};

// Frees the stock held by a guest's earlier unpaid order that this checkout replaces,
// but only when the caller proves they own it with that order's token.
const releaseReplacedGuestOrder = async (tx: Prisma.TransactionClient, replaces: unknown) => {
  if (!isRecord(replaces) || typeof replaces.orderId !== "string") return;
  const token = isGuestToken(replaces.checkoutToken) ? replaces.checkoutToken : null;
  if (!token) return;

  const owned = await tx.order.findFirst({
    where: { id: replaces.orderId, userId: null, guestAccessTokenHash: hashGuestToken(token), orderStatus: "PENDING_PAYMENT" },
    select: { id: true },
  });
  if (owned) await releaseOrderReservations(tx, owned.id);
};

/**
 * Creates a guest order (no account) and holds its stock. Idempotent per checkout token:
 * a retried, refreshed or double-submitted request with the same token and cart returns the
 * order that was already created, never a second one.
 */
export const createGuestOrder = async (input: GuestOrderInput) => {
  const token = parseGuestToken(input.checkoutToken);
  const tokenHash = hashGuestToken(token);
  const hostelId = parseCheckoutHostelId(input.hostelId);
  const items = parseCheckoutItems(input.items);

  const replayed = await findGuestOrderForReplay(tokenHash, hostelId, items);
  if (replayed) return replayed;

  try {
    return await prisma.$transaction(async (tx) => {
      await releaseReplacedGuestOrder(tx, input.replacesOrder);
      const checkout = await validateGuestCheckoutWithClient(tx, input);
      return createPendingOrder(tx, checkout, { userId: null, guestAccessTokenHash: tokenHash });
    });
  } catch (error) {
    // Two identical submissions raced: the unique token hash let only one order in.
    if (isRecord(error) && error.code === "P2002") {
      const winner = await findGuestOrderForReplay(tokenHash, hostelId, items);
      if (winner) return winner;
    }
    throw error;
  }
};

// What a customer may see about their own order on the confirmation screen.
const orderDetailSelection = {
  id: true,
  orderNumber: true,
  orderStatus: true,
  paymentStatus: true,
  subtotal: true,
  deliveryFee: true,
  total: true,
  createdAt: true,
  confirmedAt: true,
  deliveredAt: true,
  customerName: true,
  customerPhone: true,
  customerHostel: true,
  customerFloor: true,
  customerRoom: true,
  items: {
    select: {
      productName: true,
      price: true,
      unit: true,
      quantity: true,
      subtotal: true,
      product: { select: { imageUrl: true } },
    },
  },
} as const;

const maskPhone = (phone: string) => (phone.length > 4 ? `${"•".repeat(phone.length - 4)}${phone.slice(-4)}` : phone);

/**
 * A guest's own order, found only by its ID together with the secret token that created it.
 * Knowing an order ID, order number or phone number is never enough.
 */
export const getGuestOrder = async (orderId: string, rawToken: unknown) => {
  if (!isGuestToken(rawToken)) throw new CheckoutError("Order not found.", 404);

  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: null, guestAccessTokenHash: hashGuestToken(rawToken) },
    select: orderDetailSelection,
  });
  if (!order) throw new CheckoutError("Order not found.", 404);

  return { ...order, customerPhone: maskPhone(order.customerPhone) };
};

/** A signed-in customer's own order for the confirmation screen; anyone else's is "not found". */
export const getCustomerOrder = async (firebaseUid: string, orderId: string) => {
  const order = await prisma.order.findFirst({
    where: { id: orderId, user: { firebaseUid } },
    select: orderDetailSelection,
  });
  if (!order) throw new CheckoutError("Order not found.", 404);

  return { ...order, customerPhone: maskPhone(order.customerPhone) };
};

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
  // null userId marks a guest order (no account); the snapshot fields below hold its details.
  userId: true,
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
  // Transaction references only, for reconciling with the Cashfree dashboard.
  payment: { select: { cashfreeOrderId: true, cashfreePaymentId: true } },
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
  // Only the caller that wins this conditional update records confirmedAt, so the
  // delivery countdown starts once and is never reset by repeated confirmations.
  const updated = await tx.order.updateMany({
    where: { id: payment.orderId, orderStatus: "PENDING_PAYMENT" },
    data: { paymentStatus: "SUCCESS", orderStatus: "CONFIRMED", confirmedAt: new Date() },
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
