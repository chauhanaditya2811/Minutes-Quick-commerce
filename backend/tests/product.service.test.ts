import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  product: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../src/config/database.js", () => ({
  prisma: { product: mocks.product },
}));

import {
  createProduct,
  updateProduct,
} from "../src/services/product.service.js";

describe("product catalogue service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates products without writing legacy global stock", async () => {
    mocks.product.create.mockResolvedValue({ id: "product-1" });

    await createProduct({
      name: "Water",
      imageUrl: "https://images.example.test/water.jpg",
      price: 20,
      unit: "bottle",
    });

    expect(mocks.product.create).toHaveBeenCalledWith({
      data: {
        name: "Water",
        imageUrl: "https://images.example.test/water.jpg",
        description: null,
        price: 20,
        unit: "bottle",
      },
    });
  });

  it("updates catalogue fields without touching legacy global stock", async () => {
    mocks.product.findFirst.mockResolvedValue({ id: "product-1" });
    mocks.product.update.mockResolvedValue({ id: "product-1" });

    await updateProduct("product-1", {
      name: "Water",
      imageUrl: "https://images.example.test/water.jpg",
      price: 20,
      unit: "bottle",
    });

    expect(mocks.product.update).toHaveBeenCalledWith({
      where: { id: "product-1" },
      data: {
        name: "Water",
        imageUrl: "https://images.example.test/water.jpg",
        description: null,
        price: 20,
        unit: "bottle",
      },
    });
  });

  it("does not update deleted or missing products", async () => {
    mocks.product.findFirst.mockResolvedValue(null);

    await expect(
      updateProduct("missing", {
        name: "Water",
        imageUrl: "https://images.example.test/water.jpg",
        price: 20,
        unit: "bottle",
      })
    ).resolves.toBeNull();
    expect(mocks.product.update).not.toHaveBeenCalled();
  });
});
