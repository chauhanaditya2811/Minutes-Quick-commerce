import { prisma } from "../config/database.js";

export interface CreateProductData {
  name: string;
  imageUrl: string;
  description?: string;
  price: number;
  unit: string;
}

export interface UpdateProductData {
  name: string;
  imageUrl: string;
  description?: string;
  price: number;
  unit: string;
}

// Creates a new product. Stock is managed per hostel in ProductInventory.
export const createProduct = async (data: CreateProductData) => {
  return prisma.product.create({
    data: {
      name: data.name,
      imageUrl: data.imageUrl,
      description: data.description ?? null,
      price: data.price,
      unit: data.unit,
    },
  });
};

// Updates an existing non-deleted product.
export const updateProduct = async (
  id: string,
  data: UpdateProductData
) => {
  const product = await prisma.product.findFirst({
    where: {
      id,
      isDeleted: false,
    },
  });

  if (!product) {
    return null;
  }

  return prisma.product.update({
    where: {
      id,
    },
    data: {
      name: data.name,
      imageUrl: data.imageUrl,
      description: data.description ?? null,
      price: data.price,
      unit: data.unit,
    },
  });
};

// Soft-deletes an active product without removing its database row.
export const softDeleteProduct = async (id: string) => {
  const product = await prisma.product.findFirst({
    where: {
      id,
      isDeleted: false,
    },
  });

  if (!product) {
    return null;
  }

  return prisma.product.update({
    where: {
      id,
    },
    data: {
      isDeleted: true,
    },
  });
};