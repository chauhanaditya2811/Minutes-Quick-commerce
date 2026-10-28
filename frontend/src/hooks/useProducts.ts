import { api } from '../services/api';
import { previewMode } from '../services/config';
import { mockProducts } from '../data/mockProducts';
import type { Product } from '../types/product';
import { useAsync } from './useAsync';

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 250));

/** Products available at the given hostel. `stock` is that hostel's quantity. */
export function useProducts(hostelId: string | undefined) {
  return useAsync<Product[]>(async () => {
    if (!hostelId) return [];
    if (previewMode) return delay(mockProducts.map((p) => ({ ...p, hostelId })));
    return api.getProducts(hostelId);
  }, [hostelId]);
}

/** One product if it is available at the given hostel, otherwise null. */
export function useProduct(id: string | undefined, hostelId: string | undefined) {
  return useAsync<Product | null>(async () => {
    if (!id || !hostelId) return null;
    if (previewMode) {
      const product = mockProducts.find((p) => p.id === id);
      return delay(product ? { ...product, hostelId } : null);
    }
    try {
      return await api.getProduct(id, hostelId);
    } catch (e) {
      // 404 means the product is not sold at this hostel.
      if (e instanceof Error && 'status' in e && e.status === 404) return null;
      throw e;
    }
  }, [id, hostelId]);
}
