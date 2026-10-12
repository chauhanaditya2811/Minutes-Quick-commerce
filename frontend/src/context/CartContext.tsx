import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Product } from '../types/product';

export interface CartLine {
  product: Product; // snapshot for display; the backend re-validates price and stock
  quantity: number;
}

interface CartContextValue {
  lines: CartLine[];
  itemCount: number;
  /** Browser-side estimate only. The backend's validated total is authoritative. */
  subtotal: number;
  quantityOf: (productId: string) => number;
  addItem: (product: Product, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
}

const STORAGE_KEY = 'minutes.cart.v1';
const CartContext = createContext<CartContextValue | null>(null);

function load(): CartLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch {
    return [];
  }
}

const clamp = (qty: number, product: Product) => Math.max(0, Math.min(qty, product.stock));

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* storage unavailable: cart still works for this session */
    }
  }, [lines]);

  const addItem = useCallback((product: Product, quantity = 1) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        const q = clamp(existing.quantity + quantity, product);
        return prev.map((l) => (l.product.id === product.id ? { product, quantity: q } : l));
      }
      const q = clamp(quantity, product);
      return q > 0 ? [...prev, { product, quantity: q }] : prev;
    });
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setLines((prev) =>
      prev
        .map((l) => (l.product.id === productId ? { ...l, quantity: clamp(quantity, l.product) } : l))
        .filter((l) => l.quantity > 0),
    );
  }, []);

  const removeItem = useCallback((productId: string) => {
    setLines((prev) => prev.filter((l) => l.product.id !== productId));
  }, []);

  const clearCart = useCallback(() => setLines([]), []);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      itemCount: new Set(lines.map((line) => line.product.id)).size,
      subtotal: lines.reduce((s, l) => s + l.quantity * l.product.price, 0),
      quantityOf: (id) => lines.find((l) => l.product.id === id)?.quantity ?? 0,
      addItem,
      setQuantity,
      removeItem,
      clearCart,
    }),
    [lines, addItem, setQuantity, removeItem, clearCart],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
