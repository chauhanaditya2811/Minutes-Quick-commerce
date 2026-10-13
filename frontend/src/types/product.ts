/** Mirrors the Prisma Product model returned by GET /api/products. */
export interface Product {
  id: string;
  name: string;
  imageUrl: string;
  description: string | null;
  price: number; // whole INR
  unit: string;
  stock: number; // manual availability: 0 = out of stock
  isDeleted: boolean;
}

/** Mirrors GET /api/settings and GET /api/admin/settings. */
export interface StoreSettings {
  storeOpen: boolean;
  deliveryFee: number;
  minimumOrder: number;
  supportEmail: string | null;
}

/** Body for POST/PUT /api/admin/products. */
export interface ProductInput {
  name: string;
  imageUrl: string;
  description: string | null;
  price: number;
  unit: string;
  stock: number;
}
