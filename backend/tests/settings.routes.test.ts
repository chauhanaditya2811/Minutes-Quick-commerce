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
  settingUpsert: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock("../src/config/database.js", () => ({
  prisma: { setting: { upsert: mocks.settingUpsert } },
}));

vi.mock("../src/config/firebase.js", () => ({
  default: {},
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
}));

import adminSettingsRoutes from "../src/routes/admin-settings.routes.js";
import settingsRoutes from "../src/routes/settings.routes.js";

const STORE_SETTINGS = {
  storeOpen: true,
  deliveryFee: 25,
  minimumOrder: 100,
  supportEmail: "support@example.test",
};

describe("store settings routes", () => {
  let server: Server;
  let baseUrl: string;
  let previousAdminEmail: string | undefined;

  beforeAll(async () => {
    previousAdminEmail = process.env.ADMIN_EMAIL;
    process.env.ADMIN_EMAIL = "admin@example.test";

    const app = express();
    app.use(express.json());
    app.use("/api/settings", settingsRoutes);
    app.use("/api/admin/settings", adminSettingsRoutes);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Settings test server did not bind to a TCP port.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingUpsert.mockResolvedValue(STORE_SETTINGS);
    mocks.verifyIdToken.mockImplementation(async (token: string) => {
      if (token === "admin-token") {
        return { uid: "admin-user", email: "admin@example.test" };
      }
      if (token === "customer-token") {
        return { uid: "customer-user", email: "customer@example.test" };
      }
      throw new Error("Invalid test token.");
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

  it("returns only storefront settings publicly and creates defaults through Setting", async () => {
    const response = await fetch(`${baseUrl}/api/settings`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(STORE_SETTINGS);
    expect(mocks.settingUpsert).toHaveBeenCalledWith({
      where: { id: "store-settings" },
      create: {
        id: "store-settings",
        storeOpen: true,
        deliveryFee: 0,
        minimumOrder: 0,
        supportEmail: null,
      },
      update: {},
      select: {
        storeOpen: true,
        deliveryFee: true,
        minimumOrder: true,
        supportEmail: true,
      },
    });
  });

  it("rejects admin settings access without authentication or as a non-admin", async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/admin/settings`);
    const customer = await fetch(`${baseUrl}/api/admin/settings`, {
      headers: { authorization: "Bearer customer-token" },
    });

    expect(unauthenticated.status).toBe(401);
    expect(customer.status).toBe(403);
    expect(mocks.settingUpsert).not.toHaveBeenCalled();
  });

  it("allows the configured admin to retrieve settings", async () => {
    const response = await fetch(`${baseUrl}/api/admin/settings`, {
      headers: { authorization: "Bearer admin-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(STORE_SETTINGS);
    expect(mocks.settingUpsert).toHaveBeenCalledOnce();
  });

  it("persists valid updates and normalizes the support email", async () => {
    const response = await fetch(`${baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: {
        authorization: "Bearer admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        storeOpen: false,
        deliveryFee: 30,
        minimumOrder: 125,
        supportEmail: "  help@example.test  ",
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.settingUpsert).toHaveBeenCalledWith({
      where: { id: "store-settings" },
      create: {
        id: "store-settings",
        storeOpen: false,
        deliveryFee: 30,
        minimumOrder: 125,
        supportEmail: "help@example.test",
      },
      update: {
        storeOpen: false,
        deliveryFee: 30,
        minimumOrder: 125,
        supportEmail: "help@example.test",
      },
      select: {
        storeOpen: true,
        deliveryFee: true,
        minimumOrder: true,
        supportEmail: true,
      },
    });
  });

  it.each([
    ["non-object body", null],
    ["invalid store status", { ...STORE_SETTINGS, storeOpen: "closed" }],
    ["negative delivery fee", { ...STORE_SETTINGS, deliveryFee: -1 }],
    ["fractional delivery fee", { ...STORE_SETTINGS, deliveryFee: 1.5 }],
    [
      "delivery fee outside the database integer range",
      { ...STORE_SETTINGS, deliveryFee: 2_147_483_648 },
    ],
    ["negative minimum order", { ...STORE_SETTINGS, minimumOrder: -1 }],
    ["fractional minimum order", { ...STORE_SETTINGS, minimumOrder: 1.5 }],
    [
      "minimum order outside the database integer range",
      { ...STORE_SETTINGS, minimumOrder: 2_147_483_648 },
    ],
    ["invalid support email", { ...STORE_SETTINGS, supportEmail: "not-an-email" }],
  ])("rejects %s without writing settings", async (_name, body) => {
    const response = await fetch(`${baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: {
        authorization: "Bearer admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(400);
    expect(mocks.settingUpsert).not.toHaveBeenCalled();
  });

  it("accepts null to clear the support email", async () => {
    await fetch(`${baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: {
        authorization: "Bearer admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...STORE_SETTINGS, supportEmail: null }),
    });

    expect(mocks.settingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ supportEmail: null }),
      })
    );
  });
});
