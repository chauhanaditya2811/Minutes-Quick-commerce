import { createServer, type Server } from "node:http";
import express from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  orderFindMany: vi.fn(),
  orderFindUnique: vi.fn(),
  orderUpdateMany: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock("../src/config/database.js", () => ({
  prisma: {
    order: {
      findMany: mocks.orderFindMany,
      findUnique: mocks.orderFindUnique,
      updateMany: mocks.orderUpdateMany,
    },
  },
}));

vi.mock("../src/config/firebase.js", () => ({
  default: {},
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
}));

import adminOrderRoutes from "../src/routes/admin-order.routes.js";

describe("admin order routes", () => {
  let server: Server;
  let baseUrl: string;
  let previousAdminEmail: string | undefined;

  beforeAll(async () => {
    previousAdminEmail = process.env.ADMIN_EMAIL;
    process.env.ADMIN_EMAIL = "admin@example.test";

    const app = express();
    app.use(express.json());
    app.use("/api/admin", adminOrderRoutes);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Admin order test server did not bind to a TCP port.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyIdToken.mockImplementation(async (token: string) => {
      if (token === "admin-token") {
        return { uid: "firebase-admin", email: "admin@example.test" };
      }
      if (token === "customer-token") {
        return { uid: "firebase-customer", email: "customer@example.test" };
      }
      throw new Error("Invalid test token.");
    });
    mocks.orderFindMany.mockResolvedValue([]);
    mocks.orderUpdateMany.mockResolvedValue({ count: 1 });
    mocks.orderFindUnique.mockResolvedValue({
      id: "order-1",
      orderNumber: "MIN-ORDER-1",
      orderStatus: "DELIVERED",
      paymentStatus: "SUCCESS",
      deliveredAt: new Date("2026-10-12T10:00:00.000Z"),
      items: [],
    });
  });

  afterAll(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }

    if (previousAdminEmail === undefined) {
      delete process.env.ADMIN_EMAIL;
    } else {
      process.env.ADMIN_EMAIL = previousAdminEmail;
    }
  });

  it("rejects unauthenticated and non-admin order listing and status updates", async () => {
    const signedOut = await fetch(`${baseUrl}/api/admin/orders`);
    const customerList = await fetch(`${baseUrl}/api/admin/orders`, {
      headers: { authorization: "Bearer customer-token" },
    });
    const customerUpdate = await fetch(
      `${baseUrl}/api/admin/orders/order-1/status`,
      {
        method: "PATCH",
        headers: {
          authorization: "Bearer customer-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "DELIVERED" }),
      }
    );

    expect(signedOut.status).toBe(401);
    expect(customerList.status).toBe(403);
    expect(customerUpdate.status).toBe(403);
    expect(mocks.orderFindMany).not.toHaveBeenCalled();
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
  });

  it("allows the configured admin to list orders", async () => {
    const response = await fetch(`${baseUrl}/api/admin/orders`, {
      headers: { authorization: "Bearer admin-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ orders: [] });
    expect(mocks.orderFindMany).toHaveBeenCalledOnce();
  });

  it("allows the admin to mark delivered and returns the updated order", async () => {
    const response = await fetch(
      `${baseUrl}/api/admin/orders/order-1/status`,
      {
        method: "PATCH",
        headers: {
          authorization: "Bearer admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "DELIVERED" }),
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: "Order marked as delivered.",
      order: {
        id: "order-1",
        orderNumber: "MIN-ORDER-1",
        orderStatus: "DELIVERED",
        paymentStatus: "SUCCESS",
      },
    });
  });

  it("rejects unsupported order status values", async () => {
    const response = await fetch(
      `${baseUrl}/api/admin/orders/order-1/status`,
      {
        method: "PATCH",
        headers: {
          authorization: "Bearer admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "CANCELLED" }),
      }
    );

    expect(response.status).toBe(400);
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent order", async () => {
    mocks.orderUpdateMany.mockResolvedValue({ count: 0 });
    mocks.orderFindUnique.mockResolvedValue(null);

    const response = await fetch(
      `${baseUrl}/api/admin/orders/missing/status`,
      {
        method: "PATCH",
        headers: {
          authorization: "Bearer admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "DELIVERED" }),
      }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: "Order not found.",
    });
  });
});
