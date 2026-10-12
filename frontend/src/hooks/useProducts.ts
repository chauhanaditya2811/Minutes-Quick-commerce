import { api } from '../services/api';
import { previewMode } from '../services/config';
import { mockProducts } from '../data/mockProducts';
import type { Product } from '../types/product';
import { useAsync } from './useAsync';

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 250));

export function useProducts() {
  return useAsync<Product[]>(
    () => (previewMode ? delay(mockProducts) : api.getProducts()),
    [],
  );
}

export function useProduct(id: string | undefined) {
  return useAsync<Product | null>(async () => {
    if (!id) return null;
    if (previewMode) return delay(mockProducts.find((p) => p.id === id) ?? null);
    return api.getProduct(id);
  }, [id]);
}
