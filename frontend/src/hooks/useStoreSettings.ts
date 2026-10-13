import { api } from '../services/api';
import { previewMode } from '../services/config';
import { mockSettings } from '../data/mockProducts';
import type { StoreSettings } from '../types/product';
import { useAsync } from './useAsync';

export function useStoreSettings() {
  return useAsync<StoreSettings>(
    () => (previewMode ? Promise.resolve(mockSettings) : api.getSettings()),
    [],
  );
}
