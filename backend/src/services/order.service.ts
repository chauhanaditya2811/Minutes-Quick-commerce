
import { prisma } from "../config/database.js";

// Each cart item contains a product ID and the quantity requested.
export interface CheckoutItemInput {
  productId: string;
  quantity: number;
}

// Validate checkout data and calculate totals using current database prices.
export const validateCheckout = async (
  firebaseUid: string,
  items: CheckoutItemInput[]
) => {
  // Reject an empty cart.
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Your cart is empty.");
  }

  // Limit cart size and prevent duplicate product IDs.
  if (items.length > 50) {
    throw new Error("Your cart contains too many items.");
  }

  const productIds = new Set<string>();

  for (const item of items) {
    if (
      typeof item.productId !== "string" ||
      !item.productId.trim() ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 100
    ) {
      throw new Error("One or more cart items are invalid.");
    }

    if (productIds.has(item.productId)) {
      throw new Error("Your cart contains a duplicate product.");
    }

    productIds.add(item.productId);
  }

  // Load the saved customer profile; never trust delivery details from the cart.
  const user = await prisma.user.findUnique({
    where: { firebaseUid },
  });

  if (!user) {
    throw new Error("Please complete your customer profile before checkout.");
  }

  if (
    !user.name?.trim() ||
    !user.phone ||
    !user.hostel?.trim() ||
    user.floor === null ||
    !user.room?.trim()
  ) {
    throw new Error("Please complete your customer profile before checkout.");
  }

  // Read current store settings.
  const settings = await prisma.setting.findUnique({
    where: { id: "store-settings" },
  });

  if (!settings || !settings.storeOpen) {
    throw new Error("The store is currently closed.");
  }

  // Fetch current product information from the database.
  const products = await prisma.product.findMany({
    where: {
      id: { in: [...productIds] },
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

  if (products.length !== productIds.size) {
    throw new Error("One or more products are no longer available.");
  }

  const productById = new Map(
    products.map((product) => [product.id, product])
  );

  let subtotal = 0;

  const orderItems = items.map((item) => {
    const product = productById.get(item.productId);

    if (!product) {
      throw new Error("One or more products are no longer available.");
    }

    // Stock is checked manually; this does not reserve or deduct stock.
    if (product.stock === 0) {
      throw new Error(`${product.name} is out of stock.`);
    }

    if (item.quantity > product.stock) {
      throw new Error(`Only ${product.stock} unit(s) of ${product.name} are available.`);
    }

    const itemSubtotal = product.price * item.quantity;

    if (!Number.isSafeInteger(itemSubtotal)) {
      throw new Error("The cart total is too large.");
    }

    subtotal += itemSubtotal;

    return {
      productId: product.id,
      productName: product.name,
      price: product.price,
      unit: product.unit,
      quantity: item.quantity,
      subtotal: itemSubtotal,
    };
  });

  if (!Number.isSafeInteger(subtotal)) {
    throw new Error("The cart total is too large.");
  }

  // The minimum applies to product subtotal, not the delivery fee.
  if (subtotal < settings.minimumOrder) {
    throw new Error(
      `Your order must be at least ₹${settings.minimumOrder} before delivery fees.`
    );
  }

  const deliveryFee = settings.deliveryFee;
  const total = subtotal + deliveryFee;

  if (!Number.isSafeInteger(total)) {
    throw new Error("The order total is too large.");
  }

  return {
    customer: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.profileImage,
      phone: user.phone,
      hostel: user.hostel,
      floor: user.floor,
      room: user.room,
    },
    items: orderItems,
    subtotal,
    deliveryFee,
    total,
  };
};
