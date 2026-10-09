import type { Request, Response } from "express";
import {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  softDeleteProduct,
} from "../services/product.service.js";

// Validates product data and creates a new product.
export const createProductController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      name,
      imageUrl,
      description,
      price,
      unit,
      stock,
    } = req.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof imageUrl !== "string" ||
      !imageUrl.trim() ||
      typeof unit !== "string" ||
      !unit.trim()
    ) {
      res.status(400).json({
        message: "Name, imageUrl, and unit are required.",
      });
      return;
    }

    if (!Number.isInteger(price) || price < 0) {
      res.status(400).json({
        message: "Price must be a whole number greater than or equal to 0.",
      });
      return;
    }

    if (!Number.isInteger(stock) || stock < 0) {
      res.status(400).json({
        message: "Stock must be an integer greater than or equal to 0.",
      });
      return;
    }

    if (
      description !== undefined &&
      description !== null &&
      typeof description !== "string"
    ) {
      res.status(400).json({
        message: "Description must be a string.",
      });
      return;
    }

    const product = await createProduct({
      name: name.trim(),
      imageUrl: imageUrl.trim(),
      description: description?.trim(),
      price,
      unit: unit.trim(),
      stock,
    });

    res.status(201).json(product);
  } catch (error) {
    console.error("Create product error:", error);

    res.status(500).json({
      message: "Failed to create product.",
    });
  }
};

// Returns all active products visible to customers.
export const getAllProducts = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const products = await getProducts();

    res.status(200).json(products);
  } catch (error) {
    console.error("Get products error:", error);

    res.status(500).json({
      message: "Failed to get products.",
    });
  }
};

// Returns one active product by ID.
export const getSingleProduct = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    if (typeof id !== "string") {
      res.status(400).json({
        message: "Product ID is required.",
      });
      return;
    }

    const product = await getProductById(id);

    if (!product) {
      res.status(404).json({
        message: "Product not found.",
      });
      return;
    }

    res.status(200).json(product);
  } catch (error) {
    console.error("Get product error:", error);

    res.status(500).json({
      message: "Failed to get product.",
    });
  }
};

// Validates product data and updates an active product.
export const updateProductController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    if (typeof id !== "string") {
      res.status(400).json({
        message: "Product ID is required.",
      });
      return;
    }

    const {
      name,
      imageUrl,
      description,
      price,
      unit,
      stock,
    } = req.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof imageUrl !== "string" ||
      !imageUrl.trim() ||
      typeof unit !== "string" ||
      !unit.trim()
    ) {
      res.status(400).json({
        message: "Name, imageUrl, and unit are required.",
      });
      return;
    }

    if (!Number.isInteger(price) || price < 0) {
      res.status(400).json({
        message: "Price must be a whole number greater than or equal to 0.",
      });
      return;
    }

    if (!Number.isInteger(stock) || stock < 0) {
      res.status(400).json({
        message: "Stock must be an integer greater than or equal to 0.",
      });
      return;
    }

    if (
      description !== undefined &&
      description !== null &&
      typeof description !== "string"
    ) {
      res.status(400).json({
        message: "Description must be a string.",
      });
      return;
    }

    const updatedProduct = await updateProduct(id, {
      name: name.trim(),
      imageUrl: imageUrl.trim(),
      description: description?.trim(),
      price,
      unit: unit.trim(),
      stock,
    });

    if (!updatedProduct) {
      res.status(404).json({
        message: "Product not found.",
      });
      return;
    }

    res.status(200).json(updatedProduct);
  } catch (error) {
    console.error("Update product error:", error);

    res.status(500).json({
      message: "Failed to update product.",
    });
  }
};

// Soft-deletes an active product without removing its database row.
export const deleteProductController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    if (typeof id !== "string") {
      res.status(400).json({
        message: "Product ID is required.",
      });
      return;
    }

    const deletedProduct = await softDeleteProduct(id);

    if (!deletedProduct) {
      res.status(404).json({
        message: "Product not found.",
      });
      return;
    }

    res.status(200).json({
      message: "Product deleted successfully.",
    });
  } catch (error) {
    console.error("Delete product error:", error);

    res.status(500).json({
      message: "Failed to delete product.",
    });
  }
};