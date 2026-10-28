import { api, type AdminHostel } from '../../services/api';
import { previewMode } from '../../services/config';
import { mockHostels, mockProducts } from '../../data/mockProducts';
import type { AdminProduct } from '../../types/product';

/** Admin products with their per-hostel stock, plus every hostel (active and inactive). */
export interface AdminCatalogue {
  products: AdminProduct[];
  hostels: AdminHostel[];
}

const previewCatalogue = (): AdminCatalogue => ({
  hostels: mockHostels.map((h) => ({ ...h, isActive: true, createdAt: '', updatedAt: '' })),
  products: mockProducts.map((p) => ({
    id: p.id,
    name: p.name,
    imageUrl: p.imageUrl,
    description: p.description,
    price: p.price,
    unit: p.unit,
    legacyStock: p.stock,
    inventories: [
      { hostelId: 'mh1', quantity: p.stock, isAvailable: true },
      { hostelId: 'mh2', quantity: Math.floor(p.stock / 3), isAvailable: p.stock > 10 },
    ],
  })),
});

export const loadAdminCatalogue = async (): Promise<AdminCatalogue> => {
  if (previewMode) return previewCatalogue();
  const [products, hostels] = await Promise.all([api.getAdminProducts(), api.getAdminHostels()]);
  return { products, hostels };
};
