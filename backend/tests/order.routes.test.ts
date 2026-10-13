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
  verifyIdToken: vi.fn(),
}));

vi.mock("../src/config/database.js", () => ({
  prisma: { order: { findMany: mocks.orderFindMany } },
}));

vi.mock("../src/config/firebase.js", () => ({
  default: {},
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
}));

import orderRoutes from "../src/routes/order.routes.js";

describe("customer order history route", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/orders", orderRoutes);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Order route test server did not bind to a TCP port.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyIdToken.mockImplementation(async (token: string) => {
      if (token === "customer-a-token") return { uid: "firebase-customer-a" };
      if (token === "customer-b-token") return { uid: "firebase-customer-b" };
      throw new Error("Invalid test token.");
    });
    mocks.orderFindMany.mockResolvedValue([
      {
        orderNumber: "MIN-CUSTOMER-A",
        createdAt: new Date("2026-10-12T10:00:00.000Z"),
        orderStatus: "PENDING_PAYMENT",
        paymentStatus: "PENDING",
        subtotal: 120,
        deliveryFee: 20,
        total: 140,
        items: [
          {
            productName: "Water",
            price: 30,
            unit: "bottle",
            quantity: 4,
            subtotal: 120,
          },
        ],
      },
      {
        orderNumber: "MIN-CUSTOMER-A-OLDER",
        createdAt: new Date("2026-10-10T10:00:00.000Z"),
        orderStatus: "CONFIRMED",
        paymentStatus: "SUCCESS",
        subtotal: 50,
        deliveryFee: 20,
        total: 70,
        items: [
          {
            productName: "Milk",
            price: 50,
            unit: "500 ml",
            quantity: 1,
            subtotal: 50,
          },
        ],
      },
    ]);
  });

  afterAll(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("rejects signed-out visitors without querying orders", async () => {
    const response = await fetch(`${baseUrl}/api/orders/my`);

    expect(response.status).toBe(401);
    expect(mocks.orderFindMany).not.toHaveBeenCalled();
  });

  it("returns only orders scoped to the verified Firebase UID", async () => {
    const response = await fetch(
      `${baseUrl}/api/orders/my?firebaseUid=firebase-customer-b`,
      { headers: { authorization: "Bearer customer-a-token" } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      orders: [
        {
          orderNumber: "MIN-CUSTOMER-A",
          createdAt: "2026-10-12T10:00:00.000Z",
          orderStatus: "PENDING_PAYMENT",
          paymentStatus: "PENDING",
          subtotal: 120,
          deliveryFee: 20,
          total: 140,
          items: [
            {
              productName: "Water",
              price: 30,
              unit: "bottle",
              quantity: 4,
              subtotal: 120,
            },
          ],
        },
        {
          orderNumber: "MIN-CUSTOMER-A-OLDER",
          createdAt: "2026-10-10T10:00:00.000Z",
          orderStatus: "CONFIRMED",
          paymentStatus: "SUCCESS",
          subtotal: 50,
          deliveryFee: 20,
          total: 70,
          items: [
            {
              productName: "Milk",
              price: 50,
              unit: "500 ml",
              quantity: 1,
              subtotal: 50,
            },
          ],
        },
      ],
    });
    expect(mocks.orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user: { firebaseUid: "firebase-customer-a" } },
        orderBy: { createdAt: "desc" },
      })
    );
  });
});
