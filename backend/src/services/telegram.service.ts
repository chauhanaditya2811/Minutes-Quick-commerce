import { prisma } from "../config/database.js";

// Escape dynamic text before placing it inside Telegram HTML messages.
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Format prices in Indian rupees.
const formatINR = (amount: number): string =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);

// Notify the owner after a customer's Razorpay payment is confirmed.
export const notifyOwner = async (
  orderId: string,
  paymentMethod: string
): Promise<void> => {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

    // Skip notifications when Telegram has not been configured.
    if (!botToken || !chatId) {
      console.warn(
        "Telegram notification skipped: bot token or chat ID is not configured."
      );
      return;
    }

    // Read order information from the database.
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      console.error(
        "Telegram notification skipped: order was not found."
      );
      return;
    }

    // Format each item using the saved order snapshot.
    const items = order.items
      .map(
        (item) =>
          `• ${escapeHtml(item.productName)} — ${item.quantity} × ` +
          `${formatINR(item.price)} / ${escapeHtml(item.unit)} = ` +
          `${formatINR(item.subtotal)}`
      )
      .join("\n");

    // Build the order message using Telegram's HTML formatting.
    const message = [
      "<b>🛍 New Minutes Order Confirmed!</b>",
      "",
      `<b>Order:</b> ${escapeHtml(order.orderNumber)}`,
      `<b>Status:</b> ${escapeHtml(order.orderStatus)}`,
      `<b>Payment method:</b> ${escapeHtml(paymentMethod)}`,
      `<b>Total:</b> ${formatINR(order.total)}`,
      "",
      "<b>Items</b>",
      items || "No items",
      "",
      "<b>Customer Details</b>",
      `<b>Name:</b> ${escapeHtml(order.customerName)}`,
      `<b>Phone:</b> ${escapeHtml(order.customerPhone)}`,
      `<b>Email:</b> ${escapeHtml(order.customerEmail)}`,
      `<b>Hostel:</b> ${escapeHtml(order.customerHostel)}`,
      `<b>Floor:</b> ${order.customerFloor}`,
      `<b>Room:</b> ${escapeHtml(order.customerRoom)}`,
      "",
      "<b>Bill Summary</b>",
      `<b>Subtotal:</b> ${formatINR(order.subtotal)}`,
      `<b>Delivery:</b> ${formatINR(order.deliveryFee)}`,
      `<b>Total:</b> ${formatINR(order.total)}`,
    ].join("\n");

    // Send the notification through Telegram's Bot API.
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(8000),
      }
    );

    const result: unknown = await response.json().catch(() => null);

    // Check both the HTTP response and Telegram's API result.
    if (
      !response.ok ||
      typeof result !== "object" ||
      result === null ||
      !("ok" in result) ||
      result.ok !== true
    ) {
      console.error("Telegram order notification failed.", {
        httpStatus: response.status,
      });
      return;
    }

    console.info("Telegram order notification sent.", {
      orderNumber: order.orderNumber,
    });
  } catch {
    // A Telegram error must not undo a successfully confirmed payment.
    console.error(
      "Telegram order notification failed due to a network or service error."
    );
  }
};
// Alert the owner that a paid order found less hostel stock than it needed.
export const notifyStockShortfall = async (orderId: string): Promise<void> => {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
    if (!botToken || !chatId) {
      console.warn("Telegram shortfall alert skipped: bot token or chat ID is not configured.");
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) return;

    const items = order.items
      .map((item) => `• ${escapeHtml(item.productName)} × ${item.quantity}`)
      .join("\n");
    const message = [
      "<b>⚠️ Stock shortfall on a paid order</b>",
      "",
      `<b>Order:</b> ${escapeHtml(order.orderNumber)}`,
      `<b>Hostel:</b> ${escapeHtml(order.customerHostel)}`,
      `<b>Customer:</b> ${escapeHtml(order.customerName)} (${escapeHtml(order.customerPhone)})`,
      "",
      "The payment completed after the stock hold expired and the hostel no longer had enough stock.",
      "Please fulfil or refund this order manually.",
      "",
      "<b>Items</b>",
      items || "No items",
    ].join("\n");

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error("Telegram shortfall alert failed.", { httpStatus: response.status });
    }
  } catch {
    // An alert failure must not affect the confirmed payment.
    console.error("Telegram shortfall alert failed due to a network or service error.");
  }
};
