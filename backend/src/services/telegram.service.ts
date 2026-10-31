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

/** Customers are promised delivery within 10 minutes of confirmation. */
const DELIVERY_WINDOW_MS = 10 * 60_000;

// Times as the shop sees them: India time, e.g. "9:42 PM".
const formatTime = (date: Date): string =>
  new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })
    .format(date)
    .toUpperCase();

// "7498414922" → "+91 74984 14922", which Telegram makes tappable to call.
const formatPhone = (phone: string): string =>
  /^\d{10}$/.test(phone) ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` : phone;

// "blue lays" → "Blue Lays"; names already capitalised ("KitKat") are left alone.
const capitalise = (text: string): string => text.replace(/(^|\s)(\p{Ll})/gu, (_m, space: string, letter: string) => space + letter.toUpperCase());

/** The last 8 characters of the order number: short to read, still unique enough to find in admin. */
export const shortOrderCode = (orderNumber: string): string => orderNumber.slice(-8);

export interface OrderMessageInput {
  orderNumber: string;
  total: number;
  subtotal: number;
  /** The convenience fee (column name kept from when it was a delivery fee). */
  deliveryFee: number;
  lateNightFee?: number;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  customerHostel: string;
  customerFloor: string;
  customerRoom: string;
  createdAt: Date;
  confirmedAt: Date | null;
  items: { productName: string; quantity: number; subtotal: number }[];
}

/**
 * The owner's "new order" message, laid out for whoever delivers it: where to go and who to
 * call first, then what to bring, then the money, with a short order code at the end.
 */
export const formatOrderMessage = (order: OrderMessageInput, now = new Date()): string => {
  const units = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const confirmed = order.confirmedAt ?? now;
  const items = order.items
    .map((item) => `• ${item.quantity} × ${escapeHtml(capitalise(item.productName))} — ${formatINR(item.subtotal)}`)
    .join("\n");
  const fees = [
    order.deliveryFee === 0 ? "No convenience fee" : `Convenience fee ${formatINR(order.deliveryFee)}`,
    ...(order.lateNightFee ? [`Late-night ${formatINR(order.lateNightFee)}`] : []),
  ].join(" + ");

  return [
    `<b>🛵 NEW ORDER · ${formatINR(order.total)} PAID</b>`,
    `⏱ Deliver by <b>${formatTime(new Date(confirmed.getTime() + DELIVERY_WINDOW_MS))}</b>`,
    "",
    `📍 <b>${escapeHtml(order.customerHostel)}</b>`,
    `Block/Floor ${escapeHtml(order.customerFloor)} · Room ${escapeHtml(order.customerRoom)}`,
    `👤 ${escapeHtml(order.customerName)} · 📞 ${escapeHtml(formatPhone(order.customerPhone))}`,
    "",
    `<b>🛒 ${units} ${units === 1 ? "item" : "items"}</b>`,
    items || "No items",
    "",
    `💰 Items ${formatINR(order.subtotal)} + ${fees} = <b>${formatINR(order.total)}</b>`,
    "",
    `<code>#${escapeHtml(shortOrderCode(order.orderNumber))}</code> · ${order.customerEmail ? "Account" : "Guest"} · placed ${formatTime(order.createdAt)}`,
  ].join("\n");
};

// Notify the owner after a customer's payment is confirmed.
export const notifyOwner = async (orderId: string): Promise<void> => {
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

    // Built from the saved order snapshot, using Telegram's HTML formatting.
    const message = formatOrderMessage(order);

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
