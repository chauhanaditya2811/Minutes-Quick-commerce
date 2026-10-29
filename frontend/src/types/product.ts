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
  /** E.164 store phone (e.g. +919876543210) for the "Call Store" button; null if not set. */
  storePhone: string | null;
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

/** One product row of GET /api/admin/hostels/:id/inventory. */
export interface HostelStockRow {
  productId: string;
  name: string;
  imageUrl: string;
  unit: string;
  price: number;
  isAvailable: boolean;
  quantity: number; // available to sell now
  reserved: number; // held for payments in progress, not included in quantity
  exists: boolean; // false: no stock record yet at this hostel (shown as unavailable, 0)
  updatedAt: string | null;
}

/** GET /api/admin/hostels/:id/inventory — every product's stock at one hostel. */
export interface HostelStock {
  hostelId: string;
  hostelName: string;
  hostelActive: boolean;
  products: HostelStockRow[];
}

/** Body entries for PUT /api/admin/hostels/:id/inventory. */
export interface HostelStockUpdateEntry {
  productId: string;
  isAvailable: boolean;
  quantity: number;
  /** The quantity the admin saw; the save is rejected if it changed meanwhile. */
  expectedQuantity: number;
}

export const MAX_STOCK_QUANTITY = 2_147_483_647;
