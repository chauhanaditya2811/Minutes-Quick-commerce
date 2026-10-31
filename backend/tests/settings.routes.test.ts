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

const FEE_TIERS = [
  { minSubtotal: 0, fee: 10 },
  { minSubtotal: 60, fee: 15 },
  { minSubtotal: 100, fee: 20 },
];
const LATE_NIGHT = { enabled: true, fee: 5, start: "01:00", end: "06:00" };

/** The settings row as stored. */
const STORE_ROW = {
  storeOpen: true,
  deliveryFee: 10,
  minimumOrder: 100,
  supportEmail: "support@example.test",
  storePhone: "+919876543210",
  feeTiers: FEE_TIERS,
  lateNightFeeEnabled: false,
  lateNightFee: 5,
  lateNightStart: "01:00",
  lateNightEnd: "06:00",
};

/** What the admin page sends. */
const STORE_SETTINGS = {
  storeOpen: true,
  minimumOrder: 100,
  supportEmail: "support@example.test",
  storePhone: "+919876543210",
  feeTiers: FEE_TIERS,
  lateNight: LATE_NIGHT,
};

const SELECT = {
  storeOpen: true,
  deliveryFee: true,
  minimumOrder: true,
  supportEmail: true,
  storePhone: true,
  feeTiers: true,
  lateNightFeeEnabled: true,
  lateNightFee: true,
  lateNightStart: true,
  lateNightEnd: true,
};

/** What the API returns for STORE_ROW (late-night fee off, so never active). */
const PRESENTED = {
  storeOpen: true,
  minimumOrder: 100,
  supportEmail: "support@example.test",
  storePhone: "+919876543210",
  deliveryFee: 10,
  feeTiers: FEE_TIERS,
  lateNightFeeEnabled: false,
  lateNightFee: 5,
  lateNightStart: "01:00",
  lateNightEnd: "06:00",
  lateNightActive: false,
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
    mocks.settingUpsert.mockResolvedValue(STORE_ROW);
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
    await expect(response.json()).resolves.toEqual(PRESENTED);
    expect(mocks.settingUpsert).toHaveBeenCalledWith({
      where: { id: "store-settings" },
      create: {
        id: "store-settings",
        storeOpen: true,
        deliveryFee: 0,
        minimumOrder: 0,
        supportEmail: null,
        storePhone: null,
      },
      update: {},
      select: SELECT,
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
    await expect(response.json()).resolves.toEqual(PRESENTED);
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
        minimumOrder: 125,
        supportEmail: "  help@example.test  ",
        feeTiers: FEE_TIERS,
        lateNight: LATE_NIGHT,
      }),
    });

    expect(response.status).toBe(200);
    const saved = {
      storeOpen: false,
      minimumOrder: 125,
      supportEmail: "help@example.test",
      feeTiers: FEE_TIERS,
      // Kept equal to the first range for older app versions.
      deliveryFee: 10,
      lateNightFeeEnabled: true,
      lateNightFee: 5,
      lateNightStart: "01:00",
      lateNightEnd: "06:00",
    };
    expect(mocks.settingUpsert).toHaveBeenCalledWith({
      where: { id: "store-settings" },
      create: { id: "store-settings", ...saved },
      update: saved,
      select: SELECT,
    });
  });

  it("leaves the fee rules unchanged when an older admin page sends only a flat delivery fee", async () => {
    const response = await fetch(`${baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
      body: JSON.stringify({ storeOpen: true, deliveryFee: 30, minimumOrder: 0, supportEmail: null }),
    });

    expect(response.status).toBe(200);
    const update = mocks.settingUpsert.mock.calls[0][0].update;
    expect(update).not.toHaveProperty("feeTiers");
    expect(update).not.toHaveProperty("deliveryFee");
    expect(update).not.toHaveProperty("lateNightFeeEnabled");
  });

  it("allows a late-night window that crosses midnight", async () => {
    const response = await fetch(`${baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
      body: JSON.stringify({ ...STORE_SETTINGS, lateNight: { enabled: true, fee: 5, start: "23:00", end: "05:00" } }),
    });
    expect(response.status).toBe(200);
    expect(mocks.settingUpsert.mock.calls[0][0].update).toMatchObject({ lateNightStart: "23:00", lateNightEnd: "05:00" });
  });

  it.each([
    ["98765 43210", "+919876543210"],
    ["098765-43210", "+919876543210"],
    ["91 98765 43210", "+919876543210"],
    ["+91 (98765) 43210", "+919876543210"],
    ["0172 271 2345", "+911722712345"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("normalises the store phone %s to %s", async (input, expected) => {
    const response = await fetch(`${baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
      body: JSON.stringify({ ...STORE_SETTINGS, storePhone: input }),
    });

    expect(response.status).toBe(200);
    expect(mocks.settingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ storePhone: expected }) })
    );
  });

  it("keeps the saved store phone when an older admin page omits it, and clears it with null", async () => {
    const { storePhone: _omitted, ...withoutPhone } = STORE_SETTINGS;
    await fetch(`${baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
      body: JSON.stringify(withoutPhone),
    });
    expect(mocks.settingUpsert.mock.calls[0][0].update).not.toHaveProperty("storePhone");

    await fetch(`${baseUrl}/api/admin/settings`, {
      method: "PUT",
      headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
      body: JSON.stringify({ ...STORE_SETTINGS, storePhone: "" }),
    });
    expect(mocks.settingUpsert.mock.calls[1][0].update).toMatchObject({ storePhone: null });
  });

  it.each([
    ["non-object body", null],
    ["invalid store status", { ...STORE_SETTINGS, storeOpen: "closed" }],
    ["no price ranges", { ...STORE_SETTINGS, feeTiers: [] }],
    ["a first range that doesn't start at 0", { ...STORE_SETTINGS, feeTiers: [{ minSubtotal: 10, fee: 10 }] }],
    ["ranges out of order", { ...STORE_SETTINGS, feeTiers: [{ minSubtotal: 0, fee: 10 }, { minSubtotal: 100, fee: 20 }, { minSubtotal: 60, fee: 15 }] }],
    ["two ranges starting at the same amount", { ...STORE_SETTINGS, feeTiers: [{ minSubtotal: 0, fee: 10 }, { minSubtotal: 0, fee: 15 }] }],
    ["a negative fee", { ...STORE_SETTINGS, feeTiers: [{ minSubtotal: 0, fee: -1 }] }],
    ["a fractional fee", { ...STORE_SETTINGS, feeTiers: [{ minSubtotal: 0, fee: 1.5 }] }],
    ["too many price ranges", { ...STORE_SETTINGS, feeTiers: Array.from({ length: 7 }, (_, i) => ({ minSubtotal: i * 50, fee: 10 })) }],
    ["a negative late-night fee", { ...STORE_SETTINGS, lateNight: { ...LATE_NIGHT, fee: -5 } }],
    ["an invalid late-night time", { ...STORE_SETTINGS, lateNight: { ...LATE_NIGHT, start: "25:00" } }],
    ["late-night hours that start and end together", { ...STORE_SETTINGS, lateNight: { ...LATE_NIGHT, end: "01:00" } }],
    ["a late-night switch that isn't on or off", { ...STORE_SETTINGS, lateNight: { ...LATE_NIGHT, enabled: "yes" } }],
    ["negative minimum order", { ...STORE_SETTINGS, minimumOrder: -1 }],
    ["fractional minimum order", { ...STORE_SETTINGS, minimumOrder: 1.5 }],
    [
      "minimum order outside the database integer range",
      { ...STORE_SETTINGS, minimumOrder: 2_147_483_648 },
    ],
    ["invalid support email", { ...STORE_SETTINGS, supportEmail: "not-an-email" }],
    ["a store phone with letters", { ...STORE_SETTINGS, storePhone: "call-me-now" }],
    ["a too-short store phone", { ...STORE_SETTINGS, storePhone: "12345" }],
    ["a store phone starting with 0 after +", { ...STORE_SETTINGS, storePhone: "+0123456789" }],
    ["a non-string store phone", { ...STORE_SETTINGS, storePhone: 9876543210 }],
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
