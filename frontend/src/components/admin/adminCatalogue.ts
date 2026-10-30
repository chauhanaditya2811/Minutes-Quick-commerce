import { api, type AdminHostel } from '../../services/api';
import { previewMode } from '../../services/config';
import { mockHostels, mockProducts } from '../../data/mockProducts';
import type { AdminProduct, StockGroup } from '../../types/product';

/** Admin products with their per-group stock, every hostel (active and inactive) and every stock group. */
export interface AdminCatalogue {
  products: AdminProduct[];
  hostels: AdminHostel[];
  groups: StockGroup[];
}

// Preview: every sample hostel has a stock of its own, as new hostels do.
const previewCatalogue = (): AdminCatalogue => ({
  hostels: mockHostels.map((h) => ({ ...h, stockGroupId: h.id, stockGroup: { id: h.id, name: h.name }, isActive: true, createdAt: '', updatedAt: '' })),
  groups: mockHostels.map((h) => ({ id: h.id, name: h.name, hostels: [{ id: h.id, name: h.name, isActive: true }], createdAt: '', updatedAt: '' })),
  products: mockProducts.map((p) => ({
    id: p.id,
    name: p.name,
    imageUrl: p.imageUrl,
    description: p.description,
    price: p.price,
    unit: p.unit,
    legacyStock: p.stock,
    inventories: [
      { stockGroupId: 'mh1', quantity: p.stock, isAvailable: true },
      { stockGroupId: 'mh2', quantity: Math.floor(p.stock / 3), isAvailable: p.stock > 10 },
    ],
  })),
});

export const loadAdminCatalogue = async (): Promise<AdminCatalogue> => {
  if (previewMode) return previewCatalogue();
  const [products, hostels, groups] = await Promise.all([api.getAdminProducts(), api.getAdminHostels(), api.getStockGroups()]);
  return { products, hostels, groups };
};
