import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));
vi.mock("../../src/config/firebase.js", () => ({ default: {} }));
vi.mock("../../src/config/cloudinary.js", () => ({ default: {} }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ verifyIdToken: mocks.verifyIdToken }) }));

import app from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { validateCheckout } from "../../src/services/order.service.js";
import { createInventoryFixture } from "./fixtures.js";

// Customers choose a pool first and their exact hostel at checkout (real minutes_test database).
describe("pool-first shopping (minutes_test)", () => {
  let server: Server;
  let baseUrl: string;
  let fx: Awaited<ReturnType<typeof createInventoryFixture>>;
  let boys: string;
  let bh1: string;
  let bh2: string;
  let bhClosed: string;
  let girls: string;
  let closedPool: string;
  let maggi: string;

  let ipCounter = 0;
  const call = async (method: string, path: string, body?: unknown, voterToken?: string) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "x-forwarded-for": `10.40.0.${++ipCounter}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(voterToken ? { "x-voter-token": voterToken } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const voter = () => randomBytes(32).toString("base64url");
  const guestCart = (hostelId: string, poolId?: string) => ({
    hostelId,
    ...(poolId ? { poolId } : {}),
    items: [{ productId: maggi, quantity: 1 }],
    customer: { name: "Pool Student", phone: "9876543210", floor: "A/2", room: "204" },
  });

  beforeAll(async () => {
    fx = await createInventoryFixture();
    bh1 = (await fx.hostel("Pool BH-1")).id;
    boys = await fx.groupOf(bh1);
    bh2 = (await fx.hostel("Pool BH-2", boys)).id;
    bhClosed = (await fx.hostel("Pool BH-9", boys)).id;
    await prisma.hostel.update({ where: { id: bhClosed }, data: { isActive: false } });
    girls = (await fx.hostel("Pool GH-1")).id;
    const closed = (await fx.hostel("Pool Shut"))!.id;
    closedPool = await fx.groupOf(closed);
    await prisma.hostel.update({ where: { id: closed }, data: { isActive: false } });
    maggi = (await fx.product("Pool Maggi")).id;
    await fx.setStock(maggi, bh1, 10);
    await fx.setStock(maggi, girls, 4);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await fx.cleanup();
  });

  it("lists pools that serve active hostels, with only their active hostels", async () => {
    const { status, body } = await call("GET", "/api/pools");
    expect(status).toBe(200);
    const pool = body.find((p: { id: string }) => p.id === boys);
    expect(pool.hostels.map((h: { id: string }) => h.id).sort()).toEqual([bh1, bh2].sort()); // not the inactive BH-9
    expect(pool.hostels[0]).toEqual({ id: expect.any(String), name: expect.any(String) });
    expect(body.some((p: { id: string }) => p.id === closedPool)).toBe(false);
  });

  it("shows a pool's shared stock, and still accepts a hostel from older app versions", async () => {
    const byPool = await call("GET", `/api/products?poolId=${boys}`);
    expect(byPool.body.find((p: { id: string }) => p.id === maggi)).toMatchObject({ stock: 10, poolId: boys });
    const byHostel = await call("GET", `/api/products?hostelId=${bh2}`);
    expect(byHostel.body.find((p: { id: string }) => p.id === maggi)).toMatchObject({ stock: 10 });
    expect((await call("GET", `/api/products/${maggi}?poolId=${boys}`)).body).toMatchObject({ stock: 10 });
    expect((await call("GET", `/api/products?poolId=${closedPool}`)).status).toBe(404);
  });

  it("checks out a guest to the exact hostel chosen from the pool", async () => {
    const ok = await call("POST", "/api/guest/checkout/validate", guestCart(bh2, boys));
    expect(ok.status).toBe(200);
    expect(ok.body.checkout).toMatchObject({ hostelId: bh2, customer: { hostel: expect.stringContaining("Pool BH-2") } });

    const otherPool = await call("POST", "/api/guest/checkout/validate", guestCart(girls, boys));
    expect(otherPool.status).toBe(409);
    expect(otherPool.body.message).toMatch(/doesn't sell from the stock your cart/);

    expect((await call("POST", "/api/guest/checkout/validate", guestCart(bhClosed, boys))).status).toBe(409);
    // Older app versions send no pool: the hostel's own pool is used, as before.
    expect((await call("POST", "/api/guest/checkout/validate", guestCart(girls))).status).toBe(200);
  });

  it("checks a signed-in customer's saved hostel against the cart's pool", async () => {
    const student = await fx.customer(bh1);
    const items = [{ productId: maggi, quantity: 1 }];
    await expect(validateCheckout(student.firebaseUid, { hostelId: bh1, poolId: boys, items })).resolves.toMatchObject({ hostelId: bh1 });
    await expect(
      validateCheckout(student.firebaseUid, { hostelId: bh1, poolId: await fx.groupOf(girls), items })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("keeps one request board per pool, whichever hostel or pool the request names", async () => {
    const first = await call("POST", "/api/product-requests", { poolId: boys, name: `Pool Bourbon ${fx.tag}` }, voter());
    expect(first.status).toBe(201);
    // A student whose older app sends their hostel lands on the same board, as an upvote.
    const fromHostel = await call("POST", "/api/product-requests", { hostelId: bh2, name: `pool bourbon ${fx.tag}` }, voter());
    expect(fromHostel.body).toMatchObject({ duplicate: true, request: { id: first.body.request.id, votes: 2 } });

    const board = await call("GET", `/api/product-requests?poolId=${boys}`);
    expect(board.body.requests.filter((r: { id: string }) => r.id === first.body.request.id)).toHaveLength(1);
    const girlsBoard = await call("GET", `/api/product-requests?poolId=${await fx.groupOf(girls)}`);
    expect(girlsBoard.body.requests.some((r: { id: string }) => r.id === first.body.request.id)).toBe(false);

    expect((await call("GET", `/api/product-requests?poolId=${closedPool}`)).status).toBe(400);
  });
});
