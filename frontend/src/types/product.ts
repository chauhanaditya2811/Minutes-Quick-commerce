/** A product as returned by GET /api/products?hostelId=… — `stock` is that hostel's quantity. */
export interface Product {
  id: string;
  name: string;
  imageUrl: string;
  description: string | null;
  price: number; // whole INR
  unit: string;
  stock: number; // stock at the selected hostel: 0 = out of stock
  isDeleted: boolean;
  hostelId?: string;
}

/** Mirrors GET /api/settings and GET /api/admin/settings. */
export interface StoreSettings {
  storeOpen: boolean;
  deliveryFee: number;
  minimumOrder: number;
  supportEmail: string | null;
}

/** Body for POST/PUT /api/admin/products. Stock is managed per hostel. */
export interface ProductInput {
  name: string;
  imageUrl: string;
  description: string | null;
  price: number;
  unit: string;
}

/** One product's stock at one hostel, as summarised in GET /api/admin/products. */
export interface HostelInventorySummary {
  hostelId: string;
  quantity: number; // available to sell now
  isAvailable: boolean;
  reserved?: number; // held for payments in progress, not included in quantity
}

/** GET /api/admin/products. `legacyStock` is the pre-hostel global stock, never shown to customers. */
export interface AdminProduct {
  id: string;
  name: string;
  imageUrl: string;
  description: string | null;
  price: number;
  unit: string;
  legacyStock: number;
  inventories: HostelInventorySummary[];
}

/** One hostel row of GET /api/admin/products/:id/inventory. */
export interface ProductInventoryRow {
  hostelId: string;
  hostelName: string;
  hostelActive: boolean;
  isAvailable: boolean;
  quantity: number;
  reserved: number;
  exists: boolean;
  updatedAt: string | null;
}

export interface ProductInventory {
  productId: string;
  productName: string;
  legacyStock: number;
  hostels: ProductInventoryRow[];
}

/** Body entries for PUT /api/admin/products/:id/inventory. */
export interface InventoryUpdateEntry {
  hostelId: string;
  isAvailable: boolean;
  quantity: number;
  expectedQuantity?: number;
}

export const MAX_STOCK_QUANTITY = 2_147_483_647;
