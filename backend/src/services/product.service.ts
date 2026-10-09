import { prisma } from "../config/database.js";

export interface CreateProductData {
  name: string;
  imageUrl: string;
  description?: string;
  price: number;
  unit: string;
  stock: number;
}

export interface UpdateProductData {
  name: string;
  imageUrl: string;
  description?: string;
  price: number;
  unit: string;
  stock: number;
}

// Creates a new product in PostgreSQL.
export const createProduct = async (data: CreateProductData) => {
  return prisma.product.create({
    data: {
      name: data.name,
      imageUrl: data.imageUrl,
      description: data.description ?? null,
      price: data.price,
      unit: data.unit,
      stock: data.stock,
    },
  });
};

// Returns all products that are visible to customers.
export const getProducts = async () => {
  return prisma.product.findMany({
    where: {
      isDeleted: false,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
};

// Returns a single non-deleted product by its ID.
export const getProductById = async (id: string) => {
  return prisma.product.findFirst({
    where: {
      id,
      isDeleted: false,
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
      stock: data.stock,
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