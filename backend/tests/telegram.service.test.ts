import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config/database.js", () => ({ prisma: {} }));

import { formatOrderMessage, shortOrderCode } from "../src/services/telegram.service.js";

// The order from a real confirmation message, laid out for delivery.
const order = {
  orderNumber: "MIN-6FEC05F1E6F14AAFA1919C8F8F426F07",
  total: 40,
  subtotal: 30,
  deliveryFee: 10,
  customerName: "Kirti",
  customerPhone: "7498414922",
  customerEmail: null,
  customerHostel: "Narmada",
  customerFloor: "0",
  customerRoom: "107",
  createdAt: new Date("2026-11-05T16:12:00Z"), // 9:42 PM in India
  confirmedAt: new Date("2026-11-05T16:12:30Z"),
  items: [
    { productName: "blue lays", quantity: 1, subtotal: 20 },
    { productName: "Kurkure", quantity: 1, subtotal: 10 },
  ],
};

describe("Telegram order message", () => {
  it("leads with where to deliver and who to call, then items, bill and a short code", () => {
    expect(formatOrderMessage(order)).toBe(
      [
        "<b>🛵 NEW ORDER · ₹40 PAID</b>",
        "⏱ Deliver by <b>9:52 PM</b>",
        "",
        "📍 <b>Narmada</b>",
        "Block/Floor 0 · Room 107",
        "👤 Kirti · 📞 +91 74984 14922",
        "",
        "<b>🛒 2 items</b>",
        "• 1 × Blue Lays — ₹20",
        "• 1 × Kurkure — ₹10",
        "",
        "💰 Items ₹30 + Convenience fee ₹10 = <b>₹40</b>",
        "",
        "<code>#8F426F07</code> · Guest · placed 9:42 PM",
      ].join("\n")
    );
  });

  it("counts units, shows free delivery and signed-in customers, and keeps capitalised names", () => {
    const message = formatOrderMessage({
      ...order,
      deliveryFee: 0,
      total: 30,
      customerEmail: "kirti@example.test",
      items: [{ productName: "KitKat bar", quantity: 3, subtotal: 30 }],
    });
    expect(message).toContain("<b>🛒 3 items</b>");
    expect(message).toContain("• 3 × KitKat Bar — ₹30");
    expect(message).toContain("Items ₹30 + No convenience fee = <b>₹30</b>");
    expect(message).toContain("· Account ·");
    expect(message).not.toContain("kirti@example.test");
  });

  it("times delivery from confirmation, or from now if it isn't recorded", () => {
    const now = new Date("2026-11-05T18:00:00Z"); // 11:30 PM in India
    expect(formatOrderMessage({ ...order, confirmedAt: null }, now)).toContain("Deliver by <b>11:40 PM</b>");
  });

  it("escapes customer text so it can't break Telegram's formatting", () => {
    const message = formatOrderMessage({ ...order, customerName: "<b>Kirti</b>", customerRoom: "1&2" });
    expect(message).toContain("👤 &lt;b&gt;Kirti&lt;/b&gt;");
    expect(message).toContain("Room 1&amp;2");
  });

  it("keeps a non-standard phone number as it was typed", () => {
    expect(formatOrderMessage({ ...order, customerPhone: "+44 20 7946 0000" })).toContain("📞 +44 20 7946 0000");
    expect(shortOrderCode("MIN-ABC")).toBe("MIN-ABC");
  });
});
