
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  settingFindUnique: vi.fn(),
  productFindMany: vi.fn(),
}));

// Mock Prisma so these tests never write to the real database.
vi.mock("../src/config/database.js", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    setting: { findUnique: mocks.settingFindUnique },
    product: { findMany: mocks.productFindMany },
  },
}));

import { validateCheckout } from "../src/services/order.service.js";

const customer = {
  id: "user-1",
  firebaseUid: "firebase-user-1",
  email: "student@example.com",
  name: "Test Student",
  profileImage: null,
  phone: "9876543210",
  hostel: "Hostel A",
  floor: 2,
  room: "204",
};

const settings = {
  id: "store-settings",
  storeOpen: true,
  deliveryFee: 20,
  minimumOrder: 100,
  supportEmail: null,
  updatedAt: new Date(),
};

const water = {
  id: "product-1",
  name: "Water",
  price: 30,
  unit: "bottle",
  stock: 10,
};

describe("checkout validation service", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.userFindUnique.mockResolvedValue(customer);
    mocks.settingFindUnique.mockResolvedValue(settings);
    mocks.productFindMany.mockResolvedValue([water]);
  });

  it("calculates subtotal and delivery fee using database prices", async () => {
    const result = await validateCheckout("firebase-user-1", [
      { productId: "product-1", quantity: 4 },
    ]);

    expect(result.subtotal).toBe(120);
    expect(result.deliveryFee).toBe(20);
    expect(result.total).toBe(140);

    expect(result.items).toEqual([
      {
        productId: "product-1",
        productName: "Water",
        price: 30,
        unit: "bottle",
        quantity: 4,
        subtotal: 120,
      },
    ]);

    expect(mocks.productFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["product-1"] },
          isDeleted: false,
        },
      })
    );
  });

  it("rejects an empty cart", async () => {
    await expect(
      validateCheckout("firebase-user-1", [])
    ).rejects.toThrow("Your cart is empty.");
  });

  it("rejects duplicate product IDs", async () => {
    await expect(
      validateCheckout("firebase-user-1", [
        { productId: "product-1", quantity: 1 },
        { productId: "product-1", quantity: 2 },
      ])
    ).rejects.toThrow("Your cart contains a duplicate product.");
  });

  it("rejects invalid quantities", async () => {
    await expect(
      validateCheckout("firebase-user-1", [
        { productId: "product-1", quantity: 0 },
      ])
    ).rejects.toThrow("One or more cart items are invalid.");
  });

  it("rejects checkout when the customer profile is missing", async () => {
    mocks.userFindUnique.mockResolvedValue(null);

    await expect(
      validateCheckout("firebase-user-1", [
        { productId: "product-1", quantity: 4 },
      ])
    ).rejects.toThrow(
      "Please complete your customer profile before checkout."
    );
  });

  it("rejects checkout when the store is closed", async () => {
    mocks.settingFindUnique.mockResolvedValue({
      ...settings,
      storeOpen: false,
    });

    await expect(
      validateCheckout("firebase-user-1", [
        { productId: "product-1", quantity: 4 },
      ])
    ).rejects.toThrow("The store is currently closed.");
  });

  it("rejects products that are out of stock", async () => {
    mocks.productFindMany.mockResolvedValue([
      { ...water, stock: 0 },
    ]);

    await expect(
      validateCheckout("firebase-user-1", [
        { productId: "product-1", quantity: 1 },
      ])
    ).rejects.toThrow("Water is out of stock.");
  });

  it("rejects quantities above the manually configured stock", async () => {
    mocks.productFindMany.mockResolvedValue([
      { ...water, stock: 2 },
    ]);

    await expect(
      validateCheckout("firebase-user-1", [
        { productId: "product-1", quantity: 3 },
      ])
    ).rejects.toThrow(
      "Only 2 unit(s) of Water are available."
    );
  });

  it("enforces the minimum product subtotal before delivery fees", async () => {
    await expect(
      validateCheckout("firebase-user-1", [
        { productId: "product-1", quantity: 3 },
      ])
    ).rejects.toThrow(
      "Your order must be at least ₹100 before delivery fees."
    );
  });

  it("rejects products that have been deleted", async () => {
    mocks.productFindMany.mockResolvedValue([]);

    await expect(
      validateCheckout("firebase-user-1", [
        { productId: "product-1", quantity: 1 },
      ])
    ).rejects.toThrow(
      "One or more products are no longer available."
    );
  });
});
