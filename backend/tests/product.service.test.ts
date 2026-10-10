import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  product: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../src/config/database.js", () => ({
  prisma: { product: mocks.product },
}));

import {
  createProduct,
  getProducts,
  updateProduct,
} from "../src/services/product.service.js";

describe("manual product stock service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates products with the required image URL and configured stock", async () => {
    mocks.product.create.mockResolvedValue({
      id: "product-1",
      name: "Water",
      imageUrl: "https://images.example.test/water.jpg",
      description: null,
      price: 20,
      unit: "bottle",
      stock: 0,
    });

    const product = await createProduct({
      name: "Water",
      imageUrl: "https://images.example.test/water.jpg",
      price: 20,
      unit: "bottle",
      stock: 0,
    });

    expect(mocks.product.create).toHaveBeenCalledWith({
      data: {
        name: "Water",
        imageUrl: "https://images.example.test/water.jpg",
        description: null,
        price: 20,
        unit: "bottle",
        stock: 0,
      },
    });
    expect(product.stock).toBe(0);
  });

  it("keeps non-deleted zero-stock products visible in the catalog", async () => {
    const outOfStockProduct = {
      id: "product-1",
      name: "Water",
      imageUrl: "https://images.example.test/water.jpg",
      price: 20,
      unit: "bottle",
      stock: 0,
      isDeleted: false,
    };
    mocks.product.findMany.mockResolvedValue([outOfStockProduct]);

    await expect(getProducts()).resolves.toEqual([outOfStockProduct]);
    expect(mocks.product.findMany).toHaveBeenCalledWith({
      where: { isDeleted: false },
      orderBy: { createdAt: "desc" },
    });
  });

  it("updates stock only to the admin-provided value", async () => {
    mocks.product.findFirst.mockResolvedValue({ id: "product-1" });
    mocks.product.update.mockResolvedValue({
      id: "product-1",
      stock: 7,
    });

    await updateProduct("product-1", {
      name: "Water",
      imageUrl: "https://images.example.test/water.jpg",
      price: 20,
      unit: "bottle",
      stock: 7,
    });

    expect(mocks.product.update).toHaveBeenCalledWith({
      where: { id: "product-1" },
      data: {
        name: "Water",
        imageUrl: "https://images.example.test/water.jpg",
        description: null,
        price: 20,
        unit: "bottle",
        stock: 7,
      },
    });
  });
});
