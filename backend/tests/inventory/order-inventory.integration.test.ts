import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const telegram = vi.hoisted(() => ({ notifyOwner: vi.fn(), notifyStockShortfall: vi.fn() }));
vi.mock("../../src/services/telegram.service.js", () => telegram);

import { prisma } from "../../src/config/database.js";
import { createOrder, finalizePaidOrder } from "../../src/services/order.service.js";
import { expireReservations } from "../../src/services/inventory.service.js";
import { processCashfreeWebhook } from "../../src/services/cashfree-webhook.service.js";
import { verifyCashfreePaymentForCustomer } from "../../src/services/payment.service.js";
import { getHostelCatalog, getProductInventory } from "../../src/services/product-inventory.service.js";
import { createInventoryFixture } from "./fixtures.js";

const WEBHOOK_SECRET = "integration-webhook-secret";

// End-to-end order, payment and stock behaviour against the real minutes_test database.
// Cashfree's HTTP API is stubbed; no real payment is created or charged.
describe("order and payment inventory lifecycle (minutes_test)", () => {
  let fx: Awaited<ReturnType<typeof createInventoryFixture>>;
  let hostelA: string;
  let hostelB: string;
  let maggi: string;
  const previousSecret = process.env.CASHFREE_CLIENT_SECRET;
  const previousClientId = process.env.CASHFREE_CLIENT_ID;

  const checkout = (firebaseUid: string, quantity: number, productId = maggi) =>
    createOrder(firebaseUid, { hostelId: hostelA, items: [{ productId, quantity }] });

  // Simulates payment initialisation: gives the order's attempt a Cashfree order ID.
  const startPayment = async (orderId: string) => {
    const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { orderId } });
    return prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { cashfreeOrderId: `MIN-${attempt.id}`, status: "CREATED", provider: "CASHFREE" },
    });
  };

  const webhook = (cashfreeOrderId: string, amount: number, paymentId: string, eventId: string, status = "SUCCESS") => {
    fx.ids.events.push(eventId);
    const body = JSON.stringify({
      type: status === "SUCCESS" ? "PAYMENT_SUCCESS_WEBHOOK" : "PAYMENT_FAILED_WEBHOOK",
      data: {
        order: { order_id: cashfreeOrderId, order_amount: amount, order_currency: "INR" },
        payment: { cf_payment_id: paymentId, payment_status: status, payment_amount: amount, payment_currency: "INR" },
      },
    });
    const timestamp = "1700000000";
    const signature = createHmac("sha256", WEBHOOK_SECRET).update(timestamp + body).digest("base64");
    return processCashfreeWebhook(Buffer.from(body), signature, timestamp, eventId);
  };

  const stubCashfreePayment = (cashfreeOrderId: string, amount: number, paymentId: string) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify([
            { cf_payment_id: paymentId, payment_status: "SUCCESS", payment_amount: amount, payment_currency: "INR", order_id: cashfreeOrderId },
          ]),
          { status: 200 }
        )
      )
    );

  beforeAll(async () => {
    process.env.CASHFREE_CLIENT_SECRET = WEBHOOK_SECRET;
    process.env.CASHFREE_CLIENT_ID = "integration-client";
    fx = await createInventoryFixture();
    hostelA = (await fx.hostel("Flow Hostel A")).id;
    hostelB = (await fx.hostel("Flow Hostel B")).id;
    maggi = (await fx.product("Flow Maggi")).id;
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    telegram.notifyOwner.mockResolvedValue(undefined);
    telegram.notifyStockShortfall.mockResolvedValue(undefined);
    await prisma.inventoryReservation.deleteMany({ where: { userId: { in: fx.ids.users } } });
    await fx.setStock(maggi, hostelA, 10);
    await fx.setStock(maggi, hostelB, 10);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await fx.cleanup();
    process.env.CASHFREE_CLIENT_SECRET = previousSecret;
    process.env.CASHFREE_CLIENT_ID = previousClientId;
  });

  it("reduces only Hostel A's stock when a Hostel A customer orders and pays", async () => {
    const user = await fx.customer(hostelA);
    const order = await checkout(user.firebaseUid, 2);
    expect(await fx.stock(maggi, hostelA)).toBe(8);
    expect(await fx.stock(maggi, hostelB)).toBe(10);

    const attempt = await startPayment(order.id);
    const result = await webhook(attempt.cashfreeOrderId!, order.total, `cf-${randomUUID()}`, `evt-${randomUUID()}`);

    expect(result).toMatchObject({ processed: true, paymentStatus: "SUCCESS" });
    expect(await fx.stock(maggi, hostelA)).toBe(8);
    expect(await fx.stock(maggi, hostelB)).toBe(10);
    expect(await prisma.order.findUnique({ where: { id: order.id } })).toMatchObject({
      orderStatus: "CONFIRMED",
      paymentStatus: "SUCCESS",
      hostelId: hostelA,
      inventoryShortfall: false,
    });
    expect(await prisma.inventoryReservation.findFirst({ where: { orderId: order.id } })).toMatchObject({ status: "CONSUMED" });
    expect(telegram.notifyOwner).toHaveBeenCalledTimes(1);
  });

  it("rejects an order for more than the hostel has, leaving no order behind", async () => {
    const user = await fx.customer(hostelA);
    await expect(checkout(user.firebaseUid, 11)).rejects.toMatchObject({ statusCode: 409 });
    expect(await prisma.order.count({ where: { userId: user.id } })).toBe(0);
    expect(await fx.stock(maggi, hostelA)).toBe(10);
  });

  it("lets only one of two customers buy the last unit", async () => {
    await fx.setStock(maggi, hostelA, 1);
    const [first, second] = await Promise.all([fx.customer(hostelA), fx.customer(hostelA)]);

    const results = await Promise.allSettled([checkout(first.firebaseUid, 1), checkout(second.firebaseUid, 1)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ statusCode: 409 });
    expect(await fx.stock(maggi, hostelA)).toBe(0);
    // The losing checkout rolled back completely: no order without stock.
    expect(await prisma.order.count({ where: { userId: { in: [first.id, second.id] } } })).toBe(1);
  });

  it("never sells more than the limited stock to many simultaneous customers", async () => {
    await fx.setStock(maggi, hostelA, 3);
    const customers = await Promise.all(Array.from({ length: 5 }, () => fx.customer(hostelA)));

    const results = await Promise.allSettled(customers.map((c) => checkout(c.firebaseUid, 1)));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await fx.stock(maggi, hostelA)).toBe(0);
    expect(await prisma.order.count({ where: { userId: { in: customers.map((c) => c.id) } } })).toBe(3);
  });

  it("keeps the hold after a failed payment, then releases it on expiry", async () => {
    const user = await fx.customer(hostelA);
    const order = await checkout(user.firebaseUid, 3);
    const attempt = await startPayment(order.id);

    await webhook(attempt.cashfreeOrderId!, order.total, `cf-${randomUUID()}`, `evt-${randomUUID()}`, "FAILED");

    expect(await prisma.order.findUnique({ where: { id: order.id } })).toMatchObject({
      orderStatus: "PENDING_PAYMENT",
      paymentStatus: "FAILED",
    });
    expect(await fx.stock(maggi, hostelA)).toBe(7);

    await prisma.inventoryReservation.updateMany({ where: { orderId: order.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expireReservations();
    await expireReservations();
    expect(await fx.stock(maggi, hostelA)).toBe(10);

    // The released units can be bought by someone else.
    const other = await fx.customer(hostelA);
    await checkout(other.firebaseUid, 10);
    expect(await fx.stock(maggi, hostelA)).toBe(0);
  });

  it("frees a customer's abandoned checkout when they start a new one", async () => {
    await fx.setStock(maggi, hostelA, 3);
    const user = await fx.customer(hostelA);
    await checkout(user.firebaseUid, 3);
    expect(await fx.stock(maggi, hostelA)).toBe(0);

    await checkout(user.firebaseUid, 2);

    expect(await fx.stock(maggi, hostelA)).toBe(1);
  });

  it("deducts once when the same success webhook is delivered repeatedly", async () => {
    const user = await fx.customer(hostelA);
    const order = await checkout(user.firebaseUid, 2);
    const attempt = await startPayment(order.id);
    const paymentId = `cf-${randomUUID()}`;
    const eventId = `evt-${randomUUID()}`;

    await webhook(attempt.cashfreeOrderId!, order.total, paymentId, eventId);
    const concurrent = await Promise.all([
      webhook(attempt.cashfreeOrderId!, order.total, paymentId, eventId),
      webhook(attempt.cashfreeOrderId!, order.total, paymentId, eventId),
    ]);
    // A redelivery with a different event ID is still idempotent at the order level.
    const differentEvent = await webhook(attempt.cashfreeOrderId!, order.total, paymentId, `evt-${randomUUID()}`);

    for (const result of concurrent) expect(result).toMatchObject({ processed: false });
    expect(differentEvent).toMatchObject({ processed: false, reason: "already_processed" });
    expect(await fx.stock(maggi, hostelA)).toBe(8);
    expect(await prisma.cashfreeWebhookEvent.count({ where: { eventId } })).toBe(1);
    expect(await prisma.inventoryReservation.count({ where: { orderId: order.id, status: "CONSUMED" } })).toBe(1);
    expect(telegram.notifyOwner).toHaveBeenCalledTimes(1);
  });

  it("finalises once when payment verification and the webhook arrive together", async () => {
    const user = await fx.customer(hostelA);
    const order = await checkout(user.firebaseUid, 2);
    const attempt = await startPayment(order.id);
    const paymentId = `cf-${randomUUID()}`;
    stubCashfreePayment(attempt.cashfreeOrderId!, order.total, paymentId);

    const [verified, hooked] = await Promise.all([
      verifyCashfreePaymentForCustomer(user.firebaseUid, order.id, { cashfree_order_id: attempt.cashfreeOrderId }),
      webhook(attempt.cashfreeOrderId!, order.total, paymentId, `evt-${randomUUID()}`),
    ]);

    expect(verified).toMatchObject({ paymentStatus: "SUCCESS", orderStatus: "CONFIRMED" });
    expect(hooked).toMatchObject({ received: true });
    expect(await fx.stock(maggi, hostelA)).toBe(8);
    expect(await prisma.inventoryReservation.count({ where: { orderId: order.id, status: "CONSUMED" } })).toBe(1);
    expect(await prisma.payment.findUnique({ where: { orderId: order.id } })).toMatchObject({
      status: "SUCCESS",
      cashfreePaymentId: paymentId,
    });
    expect(telegram.notifyOwner).toHaveBeenCalledTimes(1);
  });

  it("re-takes stock for a payment that arrives after its hold expired", async () => {
    const user = await fx.customer(hostelA);
    const order = await checkout(user.firebaseUid, 2);
    const attempt = await startPayment(order.id);
    await prisma.inventoryReservation.updateMany({ where: { orderId: order.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expireReservations();
    expect(await fx.stock(maggi, hostelA)).toBe(10);

    await webhook(attempt.cashfreeOrderId!, order.total, `cf-${randomUUID()}`, `evt-${randomUUID()}`);

    expect(await fx.stock(maggi, hostelA)).toBe(8);
    expect(await prisma.order.findUnique({ where: { id: order.id } })).toMatchObject({ orderStatus: "CONFIRMED", inventoryShortfall: false });
    expect(telegram.notifyStockShortfall).not.toHaveBeenCalled();
  });

  it("confirms a late payment whose stock sold out, flags it and alerts the owner", async () => {
    const user = await fx.customer(hostelA);
    const order = await checkout(user.firebaseUid, 2);
    const attempt = await startPayment(order.id);
    await prisma.inventoryReservation.updateMany({ where: { orderId: order.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expireReservations();
    const other = await fx.customer(hostelA);
    await checkout(other.firebaseUid, 9); // only 1 unit left for the late payer

    await webhook(attempt.cashfreeOrderId!, order.total, `cf-${randomUUID()}`, `evt-${randomUUID()}`);

    expect(await fx.stock(maggi, hostelA)).toBe(0);
    expect(await prisma.order.findUnique({ where: { id: order.id } })).toMatchObject({
      orderStatus: "CONFIRMED",
      paymentStatus: "SUCCESS",
      inventoryShortfall: true,
    });
    expect(telegram.notifyStockShortfall).toHaveBeenCalledWith(order.id);
  });

  it("rolls back the whole payment confirmation if recording the payment fails", async () => {
    const user = await fx.customer(hostelA);
    const order = await checkout(user.firebaseUid, 2);
    const attempt = await startPayment(order.id);

    await expect(
      prisma.$transaction(async (tx) => {
        await finalizePaidOrder(tx, {
          orderId: order.id,
          attemptId: attempt.id,
          cashfreeOrderId: attempt.cashfreeOrderId!,
          cashfreePaymentId: `cf-${randomUUID()}`,
          amount: order.total,
        });
        throw new Error("simulated failure after stock was finalised");
      })
    ).rejects.toThrow("simulated failure");

    expect(await prisma.order.findUnique({ where: { id: order.id } })).toMatchObject({ orderStatus: "PENDING_PAYMENT" });
    expect(await prisma.inventoryReservation.findFirst({ where: { orderId: order.id } })).toMatchObject({ status: "ACTIVE" });
    expect(await fx.stock(maggi, hostelA)).toBe(8);
  });

  it("keeps admin held counts and customer stock consistent with the database", async () => {
    const user = await fx.customer(hostelA);
    await checkout(user.firebaseUid, 3);

    const admin = await getProductInventory(maggi);
    const rowA = admin.hostels.find((h: { hostelId: string }) => h.hostelId === hostelA);
    const rowB = admin.hostels.find((h: { hostelId: string }) => h.hostelId === hostelB);
    expect(rowA).toMatchObject({ quantity: 7, reserved: 3 });
    expect(rowB).toMatchObject({ quantity: 10, reserved: 0 });

    const catalogue = await getHostelCatalog(hostelA);
    expect(catalogue.find((p: { id: string }) => p.id === maggi)?.stock).toBe(7);
  });

  it("confirms pre-hostel orders without touching any stock", async () => {
    const user = await fx.customer(hostelA);
    const legacy = await fx.pendingOrder(user.id, null, [{ productId: maggi, quantity: 2 }]);
    const attempt = await startPayment(legacy.id);

    await webhook(attempt.cashfreeOrderId!, legacy.total, `cf-${randomUUID()}`, `evt-${randomUUID()}`);

    expect(await prisma.order.findUnique({ where: { id: legacy.id } })).toMatchObject({ orderStatus: "CONFIRMED" });
    expect(await fx.stock(maggi, hostelA)).toBe(10);
    expect(await fx.stock(maggi, hostelB)).toBe(10);
  });
});
