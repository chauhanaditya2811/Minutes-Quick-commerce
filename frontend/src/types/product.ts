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
  /** The pool whose stock this is (catalogue by pool). */
  poolId?: string;
  /** One of this pool's top sellers over the last 30 days (catalogue list only). */
  popular?: boolean;
}

/** Mirrors GET /api/settings and GET /api/admin/settings. */
/** Orders from `minSubtotal` (item total, ₹) upwards pay `fee`, until the next range starts. */
export interface FeeTier {
  minSubtotal: number;
  fee: number;
}

export interface StoreSettings {
  storeOpen: boolean;
  /** Older single fee; equals the first range's fee. */
  deliveryFee: number;
  minimumOrder: number;
  supportEmail: string | null;
  /** E.164 store phone (e.g. +919876543210) for the "Call Store" button; null if not set. */
  storePhone: string | null;
  /** Convenience fee per order-value range (first range starts at ₹0). */
  feeTiers?: FeeTier[];
  lateNightFeeEnabled?: boolean;
  lateNightFee?: number;
  /** "HH:MM", India time; the window may cross midnight. */
  lateNightStart?: string;
  lateNightEnd?: string;
  /** Whether the late-night fee applies right now (server time). */
  lateNightActive?: boolean;
}

/** Body for PUT /api/admin/settings. */
export interface StoreSettingsUpdate {
  storeOpen: boolean;
  minimumOrder: number;
  supportEmail: string | null;
  storePhone: string | null;
  feeTiers: FeeTier[];
  lateNight: { enabled: boolean; fee: number; start: string; end: string };
}

/** Body for POST/PUT /api/admin/products. Stock is managed per hostel. */
export interface ProductInput {
  name: string;
  imageUrl: string;
  description: string | null;
  price: number;
  unit: string;
}

/** One product's stock in one stock group, as summarised in GET /api/admin/products. */
export interface HostelInventorySummary {
  stockGroupId: string;
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

/** One product row of GET /api/admin/stock-groups/:id/inventory. */
export interface HostelStockRow {
  productId: string;
  name: string;
  imageUrl: string;
  unit: string;
  price: number;
  isAvailable: boolean;
  quantity: number; // available to sell now
  reserved: number; // held for payments in progress, not included in quantity
  exists: boolean; // false: no stock record yet in this group (shown as unavailable, 0)
  updatedAt: string | null;
}

/** A hostel served by a stock group. */
export interface StockGroupHostel {
  id: string;
  name: string;
  isActive: boolean;
}

/** GET /api/admin/stock-groups/:id/inventory — every product's stock in one shared stock group. */
export interface HostelStock {
  stockGroupId: string;
  name: string;
  hostels: StockGroupHostel[];
  /** True when at least one of its hostels is active (customers can buy from it). */
  active: boolean;
  products: HostelStockRow[];
}

/** GET /api/admin/stock-groups — one shared stock and the hostels that sell from it. */
export interface StockGroup {
  id: string;
  name: string;
  hostels: StockGroupHostel[];
  createdAt: string;
  updatedAt: string;
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
