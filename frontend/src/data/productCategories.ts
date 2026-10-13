/**
 * FRONTEND-ONLY presentation metadata.
 * The backend Product model has no category field, so categories are guessed
 * from product names purely to offer filter chips. Replace when a real
 * category field exists.
 */
import type { Product } from '../types/product';

export const CATEGORIES = [
  { id: 'dairy', label: 'Dairy & eggs', words: ['milk', 'egg', 'curd', 'paneer', 'butter', 'cheese'] },
  { id: 'fresh', label: 'Fruits & bread', words: ['banana', 'apple', 'bread', 'orange', 'fruit'] },
  { id: 'snacks', label: 'Snacks & instant', words: ['maggi', 'noodle', 'chips', 'biscuit', 'peanut', 'snack'] },
  { id: 'drinks', label: 'Drinks', words: ['cola', 'coffee', 'tea', 'water', 'juice'] },
  { id: 'essentials', label: 'Essentials', words: ['soap', 'detergent', 'notebook', 'shampoo', 'pen'] },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];

export function categoryOf(product: Product): CategoryId | null {
  const name = product.name.toLowerCase();
  const hit = CATEGORIES.find((c) => c.words.some((w) => name.includes(w)));
  return hit ? hit.id : null;
}
