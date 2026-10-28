import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hostelFindUnique: vi.fn(),
  hostelFindMany: vi.fn(),
  productFindFirst: vi.fn(),
  productFindMany: vi.fn(),
  inventoryFindMany: vi.fn(),
  inventoryFindFirst: vi.fn(),
  inventoryUpsert: vi.fn(),
  transaction: vi.fn(),
  reservationGroupBy: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock("../src/config/database.js", () => ({
  prisma: {
    hostel: { findUnique: mocks.hostelFindUnique, findMany: mocks.hostelFindMany },
    product: { findFirst: mocks.productFindFirst, findMany: mocks.productFindMany },
    productInventory: {
      findMany: mocks.inventoryFindMany,
      findFirst: mocks.inventoryFindFirst,
      upsert: mocks.inventoryUpsert,
    },
    inventoryReservation: { groupBy: mocks.reservationGroupBy },
    $transaction: mocks.transaction,
  },
}));
vi.mock("../src/config/firebase.js", () => ({ default: {} }));
vi.mock("../src/config/cloudinary.js", () => ({ default: {} }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ verifyIdToken: mocks.verifyIdToken }) }));

import productRoutes from "../src/routes/product.routes.js";
import adminProductRoutes from "../src/routes/admin-product.routes.js";
import adminHostelRoutes from "../src/routes/admin-hostel.routes.js";

describe("hostel-scoped product routes", () => {
  let server: Server;
  let baseUrl: string;
  let previousAdminEmail: string | undefined;

  beforeAll(async () => {
    previousAdminEmail = process.env.ADMIN_EMAIL;
    process.env.ADMIN_EMAIL = "admin@example.test";
    const app = express();
    app.use(express.json());
    app.use("/api/products", productRoutes);
    app.use("/api/admin/hostels", adminHostelRoutes);
    app.use("/api/admin", adminProductRoutes);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.reservationGroupBy.mockResolvedValue([]);
    mocks.verifyIdToken.mockImplementation(async (token: string) =>
      token === "admin"
        ? { uid: "a", email: "admin@example.test" }
        : token === "customer"
          ? { uid: "c", email: "customer@example.test" }
          : Promise.reject(new Error("bad token"))
    );
    mocks.hostelFindUnique.mockResolvedValue({ id: "hostel-a", name: "Hostel A", isActive: true });
    mocks.inventoryFindMany.mockResolvedValue([]);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ productInventory: { upsert: mocks.inventoryUpsert } })
    );
  });

  afterAll(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
    if (previousAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = previousAdminEmail;
  });

  it("requires a hostel for the customer catalogue", async () => {
    const response = await fetch(`${baseUrl}/api/products`);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ message: "Select a hostel first." });
    expect(mocks.inventoryFindMany).not.toHaveBeenCalled();
  });

  it("returns 404 for an inactive hostel", async () => {
    mocks.hostelFindUnique.mockResolvedValue({ id: "hostel-a", name: "Hostel A", isActive: false });
    const response = await fetch(`${baseUrl}/api/products?hostelId=hostel-a`);
    expect(response.status).toBe(404);
  });

  it("returns the hostel catalogue with hostel stock", async () => {
    mocks.inventoryFindMany.mockResolvedValue([
      { quantity: 12, product: { id: "product-1", name: "Maggi", price: 15 } },
    ]);
    const response = await fetch(`${baseUrl}/api/products?hostelId=hostel-a`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { id: "product-1", name: "Maggi", price: 15, stock: 12, hostelId: "hostel-a" },
    ]);
  });

  it("requires a hostel and returns 404 for products unavailable there", async () => {
    expect((await fetch(`${baseUrl}/api/products/product-1`)).status).toBe(400);

    mocks.inventoryFindFirst.mockResolvedValue(null);
    const response = await fetch(`${baseUrl}/api/products/product-1?hostelId=hostel-a`);
    expect(response.status).toBe(404);
  });

  it("protects admin inventory endpoints", async () => {
    expect((await fetch(`${baseUrl}/api/admin/products`)).status).toBe(401);
    expect(
      (await fetch(`${baseUrl}/api/admin/products/product-1/inventory`, { headers: { authorization: "Bearer customer" } })).status
    ).toBe(403);
    const put = await fetch(`${baseUrl}/api/admin/products/product-1/inventory`, {
      method: "PUT",
      headers: { authorization: "Bearer customer", "content-type": "application/json" },
      body: JSON.stringify({ entries: [{ hostelId: "hostel-a", isAvailable: true, quantity: 1 }] }),
    });
    expect(put.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid admin inventory payloads with 400", async () => {
    const response = await fetch(`${baseUrl}/api/admin/products/product-1/inventory`, {
      method: "PUT",
      headers: { authorization: "Bearer admin", "content-type": "application/json" },
      body: JSON.stringify({ entries: [{ hostelId: "hostel-a", isAvailable: true, quantity: -5 }] }),
    });
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("saves admin inventory and returns the refreshed hostel list", async () => {
    mocks.productFindFirst.mockResolvedValue({ id: "product-1", name: "Maggi", stock: 0 });
    mocks.hostelFindMany.mockImplementation(async (args?: { where?: unknown }) =>
      args?.where ? [{ id: "hostel-a", name: "Hostel A" }] : [{ id: "hostel-a", name: "Hostel A", isActive: true }]
    );
    mocks.inventoryFindMany.mockResolvedValue([
      { hostelId: "hostel-a", quantity: 30, isAvailable: true, updatedAt: new Date(0) },
    ]);

    const response = await fetch(`${baseUrl}/api/admin/products/product-1/inventory`, {
      method: "PUT",
      headers: { authorization: "Bearer admin", "content-type": "application/json" },
      body: JSON.stringify({ entries: [{ hostelId: "hostel-a", isAvailable: true, quantity: 30 }] }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hostels[0]).toMatchObject({ hostelId: "hostel-a", quantity: 30, isAvailable: true });
    expect(mocks.inventoryUpsert).toHaveBeenCalledOnce();
  });

  it("protects hostel stock endpoints from guests and non-admins", async () => {
    expect((await fetch(`${baseUrl}/api/admin/hostels/hostel-a/inventory`)).status).toBe(401);
    expect(
      (await fetch(`${baseUrl}/api/admin/hostels/hostel-a/inventory`, { headers: { authorization: "Bearer customer" } })).status
    ).toBe(403);
    const put = await fetch(`${baseUrl}/api/admin/hostels/hostel-a/inventory`, {
      method: "PUT",
      headers: { authorization: "Bearer customer", "content-type": "application/json" },
      body: JSON.stringify({ entries: [{ productId: "product-1", isAvailable: true, quantity: 1 }] }),
    });
    expect(put.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns one hostel's stock for every product to admins", async () => {
    mocks.productFindMany.mockResolvedValue([
      { id: "product-1", name: "Maggi", imageUrl: "https://x.test/m.jpg", unit: "pack", price: 15 },
    ]);
    mocks.inventoryFindMany.mockResolvedValue([
      { productId: "product-1", hostelId: "hostel-a", quantity: 12, isAvailable: true, updatedAt: new Date(0) },
    ]);

    const response = await fetch(`${baseUrl}/api/admin/hostels/hostel-a/inventory`, { headers: { authorization: "Bearer admin" } });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ hostelId: "hostel-a", hostelName: "Hostel A" });
    expect(body.products[0]).toMatchObject({ productId: "product-1", quantity: 12, isAvailable: true, reserved: 0 });
  });

  it("rejects invalid hostel stock payloads with 400 before writing", async () => {
    const response = await fetch(`${baseUrl}/api/admin/hostels/hostel-a/inventory`, {
      method: "PUT",
      headers: { authorization: "Bearer admin", "content-type": "application/json" },
      body: JSON.stringify({ entries: [{ productId: "product-1", isAvailable: true, quantity: 1.5 }] }),
    });
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
