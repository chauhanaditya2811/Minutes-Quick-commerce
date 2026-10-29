import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notifyOwner: vi.fn(),
  notifyStockShortfall: vi.fn(),
  verifyIdToken: vi.fn(),
  cashfree: vi.fn(),
}));
vi.mock("../../src/services/telegram.service.js", () => ({
  notifyOwner: mocks.notifyOwner,
  notifyStockShortfall: mocks.notifyStockShortfall,
}));
vi.mock("../../src/config/firebase.js", () => ({ default: {} }));
vi.mock("../../src/config/cloudinary.js", () => ({ default: {} }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ verifyIdToken: mocks.verifyIdToken }) }));

import app from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { createOrder, getAdminOrders } from "../../src/services/order.service.js";
import { expireReservations } from "../../src/services/inventory.service.js";
import { createInventoryFixture } from "./fixtures.js";

const SECRET = "guest-integration-secret";
const CASHFREE = "https://sandbox.cashfree.com/pg";
const realFetch = globalThis.fetch;

// Guest checkout end to end over HTTP against the real app and the minutes_test database.
// Cashfree's API is stubbed: no real payment session is created and nothing is charged.
describe("secure guest checkout (minutes_test)", () => {
  let server: Server;
  let baseUrl: string;
  let fx: Awaited<ReturnType<typeof createInventoryFixture>>;
  let hostelA: string;
  let hostelB: string;
  let maggi: string;
  let water: string;
  const env = { ...process.env };

  const newToken = () => randomBytes(32).toString("base64url");
  const hash = (token: string) => createHash("sha256").update(token).digest("hex");

  // Each request gets its own client IP so the per-IP rate limits never interfere with the
  // behaviour under test; the rate-limit test below reuses one IP on purpose.
  let ipCounter = 0;
  const nextIp = () => `10.20.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await realFetch(`${baseUrl}${path}`, {
      method,
      headers: { "x-forwarded-for": nextIp(), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  const guestCart = (overrides: Record<string, unknown> = {}) => ({
    hostelId: hostelA,
    items: [{ productId: maggi, quantity: 2 }],
    customer: { name: "Guest Student", phone: "9876543210", floor: 2, room: "204" },
    checkoutToken: newToken(),
    ...overrides,
  });

  const placeGuestOrder = async (overrides: Record<string, unknown> = {}) => {
    const cart = guestCart(overrides);
    const response = await call("POST", "/api/guest/orders", cart);
    if (response.status === 201) fx.trackOrder(response.body.order.id);
    return { ...response, token: cart.checkoutToken as string };
  };

  const startPayment = (orderId: string, token: string) =>
    call("POST", `/api/guest/orders/${orderId}/payment`, undefined, { "x-guest-order-token": token });

  // Cashfree API stub. Payment lookups return whatever `payments` holds for that Cashfree order.
  const payments = new Map<string, unknown[]>();
  const cashfreeStub = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(CASHFREE)) return realFetch(input, init);
    mocks.cashfree(url, init);
    const path = url.slice(CASHFREE.length);
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    const paymentsMatch = path.match(/^\/orders\/([^/]+)\/payments$/);
    if (paymentsMatch) return json(payments.get(decodeURIComponent(paymentsMatch[1])) ?? []);
    if (init?.method === "POST" && path === "/orders") {
      const body = JSON.parse(String(init.body));
      return json({ order_id: body.order_id, payment_session_id: `session-${body.order_id}`, order_amount: body.order_amount, order_currency: "INR" });
    }
    return new Response("not found", { status: 404 });
  };

  const webhook = async (cashfreeOrderId: string, amount: number, paymentId: string, eventId: string, status = "SUCCESS") => {
    fx.ids.events.push(eventId);
    const body = JSON.stringify({
      type: status === "SUCCESS" ? "PAYMENT_SUCCESS_WEBHOOK" : "PAYMENT_FAILED_WEBHOOK",
      data: {
        order: { order_id: cashfreeOrderId, order_amount: amount, order_currency: "INR" },
        payment: { cf_payment_id: paymentId, payment_status: status, payment_amount: amount, payment_currency: "INR" },
      },
    });
    const timestamp = "1700000000";
    const signature = createHmac("sha256", SECRET).update(timestamp + body).digest("base64");
    const response = await realFetch(`${baseUrl}/api/webhooks/cashfree`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-signature": signature, "x-webhook-timestamp": timestamp, "x-webhook-id": eventId },
      body,
    });
    return { status: response.status, body: await response.json() };
  };

  beforeAll(async () => {
    process.env.CASHFREE_CLIENT_ID = "guest-integration-client";
    process.env.CASHFREE_CLIENT_SECRET = SECRET;
    process.env.ADMIN_EMAIL = "admin@example.test";
    fx = await createInventoryFixture();
    hostelA = (await fx.hostel("Guest Hostel A")).id;
    hostelB = (await fx.hostel("Guest Hostel B")).id;
    maggi = (await fx.product("Guest Maggi", 20)).id;
    water = (await fx.product("Guest Water", 10)).id;
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.notifyOwner.mockResolvedValue(undefined);
    mocks.notifyStockShortfall.mockResolvedValue(undefined);
    mocks.verifyIdToken.mockImplementation(async (token: string) =>
      token === "admin" ? { uid: "admin", email: "admin@example.test" } : token === "customer" ? { uid: "customer-x", email: "c@example.test" } : Promise.reject(new Error("bad token"))
    );
    vi.stubGlobal("fetch", cashfreeStub);
    payments.clear();
    await prisma.inventoryReservation.deleteMany({ where: { order: { id: { in: fx.ids.orders } } } });
    await prisma.inventoryReservation.deleteMany({ where: { userId: { in: fx.ids.users } } });
    await fx.setStock(maggi, hostelA, 10);
    await fx.setStock(maggi, hostelB, 10);
    await fx.setStock(water, hostelA, 5);
    await prisma.hostel.updateMany({ where: { id: { in: [hostelA, hostelB] } }, data: { isActive: true } });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await fx.cleanup();
    process.env = env;
  });

  it("lets an unauthenticated guest price a cart and place an order without an account", async () => {
    const validated = await call("POST", "/api/guest/checkout/validate", guestCart());
    expect(validated.status).toBe(200);
    expect(validated.body.checkout).toMatchObject({ subtotal: 40, deliveryFee: 5, total: 45 });
    expect(validated.body.checkout.customer).toEqual({ name: "Guest Student", phone: "9876543210", hostel: expect.any(String), floor: 2, room: "204" });

    const placed = await placeGuestOrder();
    expect(placed.status).toBe(201);
    expect(placed.body.order).toMatchObject({ orderStatus: "PENDING_PAYMENT", total: 45 });
    expect(placed.body.order).not.toHaveProperty("guestAccessTokenHash");
    expect(placed.body.order).not.toHaveProperty("userId");

    const stored = await prisma.order.findUniqueOrThrow({ where: { id: placed.body.order.id } });
    expect(stored).toMatchObject({ userId: null, customerEmail: null, guestAccessTokenHash: hash(placed.token), customerPhone: "9876543210", customerRoom: "204", customerFloor: 2, hostelId: hostelA });
    expect(await fx.stock(maggi, hostelA)).toBe(8);
    expect(await fx.stock(maggi, hostelB)).toBe(10);
    expect(await prisma.inventoryReservation.findFirst({ where: { orderId: placed.body.order.id } })).toMatchObject({ userId: null, status: "ACTIVE", hostelId: hostelA });
  });

  it("completes a guest payment through Cashfree and confirms it exactly once", async () => {
    const placed = await placeGuestOrder();
    const started = await startPayment(placed.body.order.id, placed.token);
    expect(started.status).toBe(200);
    const { cashfreeOrderId, paymentSessionId, amount } = started.body.payment;
    expect(paymentSessionId).toBe(`session-${cashfreeOrderId}`);
    expect(amount).toBe(45);
    const created = mocks.cashfree.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(created?.[1]?.body)).customer_details).toEqual({
      customer_id: `guest_${placed.body.order.id}`,
      customer_name: "Guest Student",
      customer_phone: "9876543210",
    });

    const paymentId = `cf-${randomUUID()}`;
    const eventId = `evt-${randomUUID()}`;
    const results = await Promise.all([
      webhook(cashfreeOrderId, 45, paymentId, eventId),
      webhook(cashfreeOrderId, 45, paymentId, eventId),
      webhook(cashfreeOrderId, 45, paymentId, `evt-${randomUUID()}`),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);

    const status = await call("GET", `/api/guest/orders/${placed.body.order.id}`, undefined, { "x-guest-order-token": placed.token });
    expect(status.body.order).toMatchObject({ orderStatus: "CONFIRMED", paymentStatus: "SUCCESS", total: 45, deliveryFee: 5, customerRoom: "204" });
    expect(status.body.order.customerPhone).toBe("••••••3210");
    expect(await fx.stock(maggi, hostelA)).toBe(8);
    expect(await prisma.inventoryReservation.count({ where: { orderId: placed.body.order.id, status: "CONSUMED" } })).toBe(1);
    expect(await prisma.payment.count({ where: { orderId: placed.body.order.id } })).toBe(1);
    expect(mocks.notifyOwner).toHaveBeenCalledTimes(1);
  });

  it("confirms a guest payment through server-side verification with Cashfree", async () => {
    const placed = await placeGuestOrder();
    const { cashfreeOrderId } = (await startPayment(placed.body.order.id, placed.token)).body.payment;
    payments.set(cashfreeOrderId, [{ cf_payment_id: `cf-${randomUUID()}`, payment_status: "SUCCESS", payment_amount: 45, payment_currency: "INR", order_id: cashfreeOrderId }]);

    const verified = await call("POST", `/api/guest/orders/${placed.body.order.id}/payment/verify`, { cashfree_order_id: cashfreeOrderId }, { "x-guest-order-token": placed.token });

    expect(verified.status).toBe(200);
    expect(verified.body.payment).toMatchObject({ paymentStatus: "SUCCESS", orderStatus: "CONFIRMED" });
    // A refresh re-verifies idempotently: no second confirmation or deduction.
    await call("POST", `/api/guest/orders/${placed.body.order.id}/payment/verify`, { cashfree_order_id: cashfreeOrderId }, { "x-guest-order-token": placed.token });
    expect(mocks.notifyOwner).toHaveBeenCalledTimes(1);
    expect(await fx.stock(maggi, hostelA)).toBe(8);
  });

  it("never marks an order paid from the browser alone or for the wrong amount", async () => {
    const placed = await placeGuestOrder();
    const { cashfreeOrderId } = (await startPayment(placed.body.order.id, placed.token)).body.payment;
    const headers = { "x-guest-order-token": placed.token };

    // The browser claims success, but Cashfree reports no successful payment.
    const unpaid = await call("POST", `/api/guest/orders/${placed.body.order.id}/payment/verify`, { cashfree_order_id: cashfreeOrderId }, headers);
    expect(unpaid.status).toBe(409);

    // Cashfree reports a success for a different amount.
    payments.set(cashfreeOrderId, [{ cf_payment_id: "cf-wrong", payment_status: "SUCCESS", payment_amount: 1, payment_currency: "INR", order_id: cashfreeOrderId }]);
    const wrongAmount = await call("POST", `/api/guest/orders/${placed.body.order.id}/payment/verify`, { cashfree_order_id: cashfreeOrderId }, headers);
    expect(wrongAmount.status).toBe(409);

    // A Cashfree order belonging to another guest's order is not accepted for this one.
    const other = await placeGuestOrder({ items: [{ productId: water, quantity: 1 }] });
    const otherCf = (await startPayment(other.body.order.id, other.token)).body.payment.cashfreeOrderId;
    const crossed = await call("POST", `/api/guest/orders/${placed.body.order.id}/payment/verify`, { cashfree_order_id: otherCf }, headers);
    expect(crossed.status).toBe(404);

    expect(await prisma.order.findUniqueOrThrow({ where: { id: placed.body.order.id } })).toMatchObject({ orderStatus: "PENDING_PAYMENT" });
    expect(await prisma.payment.findUnique({ where: { orderId: placed.body.order.id } })).toMatchObject({ status: "CREATED" });
  });

  it.each([
    ["missing delivery details", { customer: undefined }],
    ["a one-letter name", { customer: { name: "A", phone: "9876543210", floor: 2, room: "204" } }],
    ["a phone not starting 6-9", { customer: { name: "Guest", phone: "5876543210", floor: 2, room: "204" } }],
    ["a short phone", { customer: { name: "Guest", phone: "98765", floor: 2, room: "204" } }],
    ["a negative floor", { customer: { name: "Guest", phone: "9876543210", floor: -1, room: "204" } }],
    ["a fractional floor", { customer: { name: "Guest", phone: "9876543210", floor: 2.5, room: "204" } }],
    ["an empty room", { customer: { name: "Guest", phone: "9876543210", floor: 2, room: " " } }],
    ["an overlong room", { customer: { name: "Guest", phone: "9876543210", floor: 2, room: "x".repeat(21) } }],
    ["a weak checkout token", { checkoutToken: "short" }],
  ])("rejects %s without creating an order", async (_label, overrides) => {
    // Count only this file's hostel: other test files create orders in parallel.
    const before = await prisma.order.count({ where: { hostelId: hostelA } });
    const placed = await placeGuestOrder(overrides);
    expect(placed.status).toBe(400);
    expect(await prisma.order.count({ where: { hostelId: hostelA } })).toBe(before);
    expect(await fx.stock(maggi, hostelA)).toBe(10);
  });

  it("ignores client-supplied prices, fees and totals", async () => {
    const placed = await placeGuestOrder({
      items: [{ productId: maggi, quantity: 2, price: 1 }],
      subtotal: 1,
      deliveryFee: 0,
      total: 1,
      amount: 1,
    });
    expect(placed.status).toBe(201);
    expect(placed.body.order).toMatchObject({ subtotal: 40, deliveryFee: 5, total: 45 });
    expect(placed.body.order.items[0]).toMatchObject({ price: 20, subtotal: 40 });
  });

  it("rejects unavailable products, insufficient stock and inactive hostels", async () => {
    expect((await placeGuestOrder({ items: [{ productId: maggi, quantity: 11 }] })).status).toBe(409);

    await fx.setStock(water, hostelA, 5, false);
    expect((await placeGuestOrder({ items: [{ productId: water, quantity: 1 }] })).status).toBe(409);

    await prisma.hostel.update({ where: { id: hostelA }, data: { isActive: false } });
    expect((await placeGuestOrder()).status).toBe(409);

    expect(await fx.stock(maggi, hostelA)).toBe(10);
  });

  it("lets only one of two simultaneous guests buy the last unit", async () => {
    await fx.setStock(maggi, hostelA, 1);
    const [first, second] = await Promise.all([
      placeGuestOrder({ items: [{ productId: maggi, quantity: 1 }] }),
      placeGuestOrder({ items: [{ productId: maggi, quantity: 1 }] }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await fx.stock(maggi, hostelA)).toBe(0);
  });

  it("returns the same order for repeated or simultaneous submissions of one checkout", async () => {
    const cart = guestCart();
    const responses = await Promise.all([1, 2, 3].map(() => call("POST", "/api/guest/orders", cart)));
    const again = await call("POST", "/api/guest/orders", cart);
    for (const response of [...responses, again]) fx.trackOrder(response.body.order.id);

    const ids = new Set([...responses, again].map((r) => r.body.order.id));
    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(ids.size).toBe(1);
    expect(await prisma.order.count({ where: { guestAccessTokenHash: hash(cart.checkoutToken) } })).toBe(1);
    expect(await fx.stock(maggi, hostelA)).toBe(8);

    // Reusing a checkout token for a different cart is refused rather than mixed up.
    const changed = await call("POST", "/api/guest/orders", { ...cart, items: [{ productId: maggi, quantity: 3 }] });
    expect(changed.status).toBe(409);
  });

  it("frees the stock of a guest's replaced unpaid order", async () => {
    const first = await placeGuestOrder({ items: [{ productId: maggi, quantity: 3 }] });
    expect(await fx.stock(maggi, hostelA)).toBe(7);

    const second = await placeGuestOrder({ replacesOrder: { orderId: first.body.order.id, checkoutToken: first.token } });

    expect(second.status).toBe(201);
    expect(await fx.stock(maggi, hostelA)).toBe(8);
    expect(await prisma.inventoryReservation.findFirst({ where: { orderId: first.body.order.id } })).toMatchObject({ status: "RELEASED" });
  });

  it("keeps the hold after a failed payment, allows a retry, and releases it on expiry", async () => {
    const placed = await placeGuestOrder();
    const { cashfreeOrderId } = (await startPayment(placed.body.order.id, placed.token)).body.payment;

    await webhook(cashfreeOrderId, 45, `cf-${randomUUID()}`, `evt-${randomUUID()}`, "FAILED");
    expect(await prisma.order.findUniqueOrThrow({ where: { id: placed.body.order.id } })).toMatchObject({ paymentStatus: "FAILED", orderStatus: "PENDING_PAYMENT" });
    expect(await fx.stock(maggi, hostelA)).toBe(8);

    const retry = await startPayment(placed.body.order.id, placed.token);
    expect(retry.status).toBe(200);
    expect(retry.body.payment.cashfreeOrderId).not.toBe(cashfreeOrderId);

    await prisma.inventoryReservation.updateMany({ where: { orderId: placed.body.order.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expireReservations();
    expect(await fx.stock(maggi, hostelA)).toBe(10);
  });

  it("shows guest orders to the admin with everything needed for delivery", async () => {
    const placed = await placeGuestOrder();
    const { cashfreeOrderId } = (await startPayment(placed.body.order.id, placed.token)).body.payment;
    await webhook(cashfreeOrderId, 45, "cf-admin-visible", `evt-${randomUUID()}`);

    const listed = (await getAdminOrders()).find((order) => order.id === placed.body.order.id);
    expect(listed).toMatchObject({
      userId: null,
      customerName: "Guest Student",
      customerEmail: null,
      customerPhone: "9876543210",
      customerFloor: 2,
      customerRoom: "204",
      total: 45,
      deliveryFee: 5,
      paymentStatus: "SUCCESS",
      orderStatus: "CONFIRMED",
      payment: { cashfreeOrderId, cashfreePaymentId: "cf-admin-visible" },
    });
    expect(listed?.items).toEqual([expect.objectContaining({ quantity: 2, subtotal: 40 })]);
    expect(listed).not.toHaveProperty("guestAccessTokenHash");
  });

  it("keeps admin and customer endpoints protected", async () => {
    expect((await call("GET", "/api/admin/orders")).status).toBe(401);
    expect((await call("GET", "/api/admin/orders", undefined, { authorization: "Bearer customer" })).status).toBe(403);
    expect((await call("GET", "/api/admin/hostels/x/inventory")).status).toBe(401);
    expect((await call("POST", "/api/orders", { hostelId: hostelA, items: [] })).status).toBe(401);
    expect((await call("GET", "/api/orders/my")).status).toBe(401);
  });

  it("never reveals a guest order without its own secret token", async () => {
    const placed = await placeGuestOrder();
    const other = await placeGuestOrder({ items: [{ productId: water, quantity: 1 }] });
    expect([placed.status, other.status]).toEqual([201, 201]);
    const id = placed.body.order.id;

    expect((await call("GET", `/api/guest/orders/${id}`)).status).toBe(404);
    expect((await call("GET", `/api/guest/orders/${id}`, undefined, { "x-guest-order-token": newToken() })).status).toBe(404);
    expect((await call("GET", `/api/guest/orders/${id}`, undefined, { "x-guest-order-token": other.token })).status).toBe(404);
    expect((await call("GET", `/api/guest/orders/${placed.body.order.orderNumber}`, undefined, { "x-guest-order-token": placed.token })).status).toBe(404);
    expect((await startPayment(id, other.token)).status).toBe(404);
    // A signed-in customer cannot pay for or verify someone's guest order either.
    expect((await call("POST", `/api/orders/${id}/payment`, undefined, { authorization: "Bearer customer" })).status).toBe(404);
  });

  it("rate-limits order creation per client IP", async () => {
    const headers = { "x-forwarded-for": "10.99.0.1" };
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      // Invalid bodies are rejected cheaply but still count towards the limit.
      statuses.push((await call("POST", "/api/guest/orders", { checkoutToken: "bad" }, headers)).status);
    }
    expect(statuses.slice(0, 60).every((status) => status === 400)).toBe(true);
    expect(statuses[60]).toBe(429);
    // Another client IP is unaffected.
    expect((await call("POST", "/api/guest/orders", { checkoutToken: "bad" }, { "x-forwarded-for": "10.99.0.2" })).status).toBe(400);
  });

  it("records confirmedAt once on confirmation and never resets it", async () => {
    const placed = await placeGuestOrder();
    const headers = { "x-guest-order-token": placed.token };
    const pending = await call("GET", `/api/guest/orders/${placed.body.order.id}`, undefined, headers);
    expect(pending.body.order.confirmedAt).toBeNull();
    expect(Date.parse(pending.body.serverTime)).not.toBeNaN();

    const { cashfreeOrderId } = (await startPayment(placed.body.order.id, placed.token)).body.payment;
    const before = Date.now();
    await webhook(cashfreeOrderId, 45, "cf-confirmed-at", `evt-${randomUUID()}`);
    const first = (await prisma.order.findUniqueOrThrow({ where: { id: placed.body.order.id } })).confirmedAt;
    expect(first).toBeInstanceOf(Date);
    expect(first!.getTime()).toBeGreaterThanOrEqual(before - 1000);

    // A duplicate webhook and a later verification must not move the countdown's start.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await webhook(cashfreeOrderId, 45, "cf-confirmed-at", `evt-${randomUUID()}`);
    payments.set(cashfreeOrderId, [{ cf_payment_id: "cf-confirmed-at", payment_status: "SUCCESS", payment_amount: 45, payment_currency: "INR", order_id: cashfreeOrderId }]);
    await call("POST", `/api/guest/orders/${placed.body.order.id}/payment/verify`, { cashfree_order_id: cashfreeOrderId }, headers);

    const confirmed = await call("GET", `/api/guest/orders/${placed.body.order.id}`, undefined, headers);
    expect(confirmed.body.order.orderStatus).toBe("CONFIRMED");
    expect(confirmed.body.order.confirmedAt).toBe(first!.toISOString());
  });

  it("returns a signed-in customer's own order with confirmedAt, and nobody else's", async () => {
    const owner = await prisma.user.create({
      data: { firebaseUid: "customer-x", email: `owner-${randomUUID()}@example.test`, name: "Owner", phone: "9876543210", hostelId: hostelA, floor: 1, room: "11" },
    });
    fx.ids.users.push(owner.id);
    const mine = await createOrder("customer-x", { hostelId: hostelA, items: [{ productId: maggi, quantity: 1 }] });
    fx.trackOrder(mine.id);
    const guest = await placeGuestOrder();

    const response = await call("GET", `/api/orders/${mine.id}`, undefined, { authorization: "Bearer customer" });
    expect(response.status).toBe(200);
    expect(response.body.order).toMatchObject({ id: mine.id, orderStatus: "PENDING_PAYMENT", confirmedAt: null, customerPhone: "••••••3210" });
    expect(response.body.order).not.toHaveProperty("userId");
    expect(Date.parse(response.body.serverTime)).not.toBeNaN();

    // Not signed in, someone else's order, or a guest order: all "not found" or unauthorised.
    expect((await call("GET", `/api/orders/${mine.id}`)).status).toBe(401);
    expect((await call("GET", `/api/orders/${guest.body.order.id}`, undefined, { authorization: "Bearer customer" })).status).toBe(404);
    // The order-history route still resolves before the order-ID route.
    expect((await call("GET", "/api/orders/my", undefined, { authorization: "Bearer customer" })).status).toBe(200);
  });

  it("keeps signed-in checkout working and every order owned by a user or a guest token", async () => {
    const customer = await fx.customer(hostelA);
    const order = await createOrder(customer.firebaseUid, { hostelId: hostelA, items: [{ productId: maggi, quantity: 1 }] });
    fx.trackOrder(order.id);
    expect(order).toMatchObject({ userId: customer.id, guestAccessTokenHash: null, customerEmail: customer.email });
    expect(await fx.stock(maggi, hostelA)).toBe(9);

    await expect(
      prisma.order.create({
        data: {
          orderNumber: `MIN-NOOWNER-${randomUUID()}`,
          subtotal: 1, deliveryFee: 0, total: 1,
          paymentStatus: "PENDING", orderStatus: "PENDING_PAYMENT",
          customerName: "Nobody", customerPhone: "9876543210", customerHostel: "X", customerFloor: 1, customerRoom: "1",
        },
      })
    ).rejects.toThrow();
  });
});
