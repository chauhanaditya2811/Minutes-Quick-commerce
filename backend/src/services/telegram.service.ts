
import { prisma } from "../config/database.js";

/**
 * Sends a Telegram message to the configured chat informing about a successful order payment.
 * This function is fire‑and‑forget; any network errors are caught and logged without affecting the caller.
 */
export async function notifyOwner(orderId: string, paymentMethod: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.warn(
      "Telegram notification skipped – missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in environment."
    );
    return;
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        total: true,
        subtotal: true,
        deliveryFee: true,
        isFiveMinute: true,
        customerName: true,
        customerPhone: true,
        customerHostel: true,
        customerFloor: true,
        customerRoom: true,
        items: {
          select: {
            productName: true,
            quantity: true,
            price: true,
            subtotal: true,
          },
        },
      },
    });

    if (!order) {
      console.warn("Telegram notification skipped – order not found", { orderId });
      return;
    }

    const itemLines = order.items
      .map((item) => `  • ${item.productName} × ${item.quantity} — ₹${item.subtotal}`)
      .join("\n");

    const text = [
      `✅ *New Order Confirmed*`,
      ``,
      `*Order #:* ${order.orderNumber}`,
      `*Payment:* ${paymentMethod}`,
      order.isFiveMinute ? `⚡ *5-Minute Delivery*` : "",
      ``,
      `*Items:*`,
      itemLines,
      ``,
      `*Subtotal:* ₹${order.subtotal}`,
      `*Delivery Fee:* ₹${order.deliveryFee}`,
      `*Total:* ₹${order.total}`,
      ``,
      `*Deliver to:*`,
      `${order.customerName}`,
      `${order.customerHostel}, Floor ${order.customerFloor}, Room ${order.customerRoom}`,
      `📞 ${order.customerPhone}`,
    ]
      .filter(Boolean)
      .join("\n");

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.warn("Telegram API responded with error", {
        status: response.status,
        body: errorBody,
      });
    }
  } catch (err) {
    console.warn("Failed to send Telegram notification", { error: err });
  }
}
