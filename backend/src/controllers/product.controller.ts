import type { Request, Response } from "express";
import {
  createProduct,
  updateProduct,
  softDeleteProduct,
} from "../services/product.service.js";
import {
  InventoryServiceError,
  getAdminProductsWithInventory,
  getHostelCatalog,
  getHostelProduct,
  getProductInventory,
  updateProductInventory,
} from "../services/product-inventory.service.js";

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
    });

    res.status(201).json(product);
  } catch (error) {
    console.error("Create product error:", error);

    res.status(500).json({
      message: "Failed to create product.",
    });
  }
};

const getHostelIdQuery = (req: Request): string | null => {
  const { hostelId } = req.query;
  return typeof hostelId === "string" && hostelId.trim() ? hostelId.trim() : null;
};

const sendInventoryError = (
  error: unknown,
  res: Response,
  fallback: string
): void => {
  if (error instanceof InventoryServiceError) {
    res.status(error.statusCode).json({ message: error.message });
    return;
  }

  console.error(fallback, error);
  res.status(500).json({ message: fallback });
};

// Returns the products available to customers at the selected hostel.
export const getAllProducts = async (
  req: Request,
  res: Response
): Promise<void> => {
  const hostelId = getHostelIdQuery(req);

  if (!hostelId) {
    res.status(400).json({ message: "Select a hostel first." });
    return;
  }

  try {
    res.status(200).json(await getHostelCatalog(hostelId));
  } catch (error) {
    sendInventoryError(error, res, "Failed to get products.");
  }
};

// Returns one product if it is available at the selected hostel.
export const getSingleProduct = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const hostelId = getHostelIdQuery(req);

  if (typeof id !== "string" || !id.trim()) {
    res.status(400).json({
      message: "Product ID is required.",
    });
    return;
  }

  if (!hostelId) {
    res.status(400).json({ message: "Select a hostel first." });
    return;
  }

  try {
    const product = await getHostelProduct(hostelId, id);

    if (!product) {
      res.status(404).json({
        message: "Product not found at this hostel.",
      });
      return;
    }

    res.status(200).json(product);
  } catch (error) {
    sendInventoryError(error, res, "Failed to get product.");
  }
};

// Admin-only product list with per-hostel inventory.
export const getAdminProductsController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    res.status(200).json(await getAdminProductsWithInventory());
  } catch (error) {
    sendInventoryError(error, res, "Failed to get products.");
  }
};

// Admin-only inventory of one product across every hostel.
export const getProductInventoryController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;

  if (typeof id !== "string" || !id.trim()) {
    res.status(400).json({ message: "Product ID is required." });
    return;
  }

  try {
    res.status(200).json(await getProductInventory(id));
  } catch (error) {
    sendInventoryError(error, res, "Failed to get product inventory.");
  }
};

// Admin-only bulk save of one product's hostel inventory.
export const updateProductInventoryController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;

  if (typeof id !== "string" || !id.trim()) {
    res.status(400).json({ message: "Product ID is required." });
    return;
  }

  try {
    res.status(200).json(await updateProductInventory(id, req.body?.entries));
  } catch (error) {
    sendInventoryError(error, res, "Failed to save product inventory.");
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