/**
 * PREVIEW DATA ONLY. Used when running `npm run dev` without VITE_API_BASE_URL.
 * Never imported by pages directly — see hooks/useProducts.ts and hooks/useStoreSettings.ts.
 */
import type { Product, StoreSettings } from '../types/product';
import type { Hostel } from '../services/api';

export const mockHostels: Hostel[] = [
  { id: 'mh1', name: 'Aravali Hostel' },
  { id: 'mh2', name: 'Kailash Hostel' },
  { id: 'mh3', name: 'Nilgiri Hostel' },
];

const art = (emoji: string, bg: string): string =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="${bg}"/><text x="120" y="150" font-size="104" text-anchor="middle">${emoji}</text></svg>`,
  );

const p = (
  id: string,
  name: string,
  emoji: string,
  bg: string,
  description: string,
  price: number,
  unit: string,
  stock: number,
): Product => ({ id, name, imageUrl: art(emoji, bg), description, price, unit, stock, isDeleted: false });

export const mockProducts: Product[] = [
  p('m1', 'Toned Milk', '🥛', '#E0F2FE', 'Fresh toned milk, pasteurised and ready to boil.', 30, '500 ml', 24),
  p('m2', 'Farm Eggs', '🥚', '#FEF3C7', 'White eggs, tray of six. Keep refrigerated.', 54, '6 pcs', 12),
  p('m3', 'Bananas', '🍌', '#FEF9C3', 'Ripe yelakki bananas, good for a quick breakfast.', 40, '6 pcs', 30),
  p('m4', 'Maggi Masala Noodles', '🍜', '#FFEDD5', 'Instant masala noodles. Four-pack for late-night study sessions.', 56, '4 × 70 g', 40),
  p('m5', 'Sandwich Bread', '🍞', '#FDE68A', 'Soft white sandwich bread, sliced.', 45, '400 g', 8),
  p('m6', 'Salted Chips', '🥔', '#FEE2E2', 'Crunchy potato chips with classic salt.', 20, '52 g', 60),
  p('m7', 'Cola', '🥤', '#FECACA', 'Chilled-style cola bottle for the hostel fridge.', 40, '750 ml', 18),
  p('m8', 'Instant Coffee', '☕', '#E7E5E4', 'Strong instant coffee. About 40 cups per jar.', 165, '50 g', 14),
  p('m9', 'Bathing Soap', '🧼', '#DBEAFE', 'Mild bathing soap bar.', 38, '100 g', 22),
  p('m10', 'Notebook, Ruled', '📓', '#E0E7FF', 'A4 ruled notebook, 172 pages.', 70, '1 pc', 35),
  p('m11', 'Apples', '🍎', '#FEE2E2', 'Crisp red apples, sold per pack of four.', 120, '4 pcs', 0),
  p('m12', 'Curd', '🥣', '#F1F5F9', 'Thick set curd in a cup.', 25, '200 g', 3),
  p('m13', 'Peanut Butter', '🥜', '#FFEDD5', 'Creamy peanut butter, no added sugar.', 189, '340 g', 9),
  p('m14', 'Biscuits', '🍪', '#FEF3C7', 'Glucose biscuits, family pack.', 30, '200 g', 50),
  p('m15', 'Laundry Detergent', '🧺', '#CFFAFE', 'Detergent powder sachet for hand wash.', 45, '500 g', 16),
  p('m16', 'Packaged Water', '💧', '#E0F2FE', 'Sealed drinking water bottle.', 20, '1 L', 80),
];

export const mockSettings: StoreSettings = {
  storeOpen: true,
  deliveryFee: 10,
  minimumOrder: 49,
  supportEmail: 'support@example.com',
};
