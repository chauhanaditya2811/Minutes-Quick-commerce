import { api } from '../services/api';
import { previewMode } from '../services/config';
import { mockProducts } from '../data/mockProducts';
import type { Product } from '../types/product';
import { useAsync } from './useAsync';

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 250));

/** Products available in the given pool. `stock` is the pool's shared quantity. */
export function useProducts(poolId: string | undefined) {
  return useAsync<Product[]>(async () => {
    if (!poolId) return [];
    if (previewMode) return delay(mockProducts.map((p) => ({ ...p, poolId })));
    return api.getProducts(poolId);
  }, [poolId]);
}

/** One product if it is available in the given pool, otherwise null. */
export function useProduct(id: string | undefined, poolId: string | undefined) {
  return useAsync<Product | null>(async () => {
    if (!id || !poolId) return null;
    if (previewMode) {
      const product = mockProducts.find((p) => p.id === id);
      return delay(product ? { ...product, poolId } : null);
    }
    try {
      return await api.getProduct(id, poolId);
    } catch (e) {
      // 404 means the product is not sold in this pool.
      if (e instanceof Error && 'status' in e && e.status === 404) return null;
      throw e;
    }
  }, [id, poolId]);
}
