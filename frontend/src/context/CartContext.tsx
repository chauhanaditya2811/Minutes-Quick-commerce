import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Product } from '../types/product';
import { useHostel } from './HostelContext';

export interface CartLine {
  product: Product; // snapshot for display; the backend re-validates price and stock
  quantity: number;
}

interface CartContextValue {
  /** The hostel this cart belongs to. Every line uses that hostel's stock. */
  hostelId: string | null;
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

interface StoredCart {
  hostelId: string | null;
  lines: CartLine[];
}

// v2 binds the cart to one hostel. v1 carts held global stock snapshots and are discarded.
const STORAGE_KEY = 'minutes.cart.v2';
const CartContext = createContext<CartContextValue | null>(null);

function load(): StoredCart {
  try {
    localStorage.removeItem('minutes.cart.v1');
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<StoredCart>) : null;
    return stored && Array.isArray(stored.lines)
      ? { hostelId: typeof stored.hostelId === 'string' ? stored.hostelId : null, lines: stored.lines }
      : { hostelId: null, lines: [] };
  } catch {
    return { hostelId: null, lines: [] };
  }
}

const clamp = (qty: number, product: Product) => Math.max(0, Math.min(qty, product.stock));

export function CartProvider({ children }: { children: ReactNode }) {
  const { selectedHostel } = useHostel();
  const hostelId = selectedHostel?.id ?? null;
  const [cart, setCart] = useState<StoredCart>(load);
  // A cart never carries items from one hostel into another.
  const lines = useMemo(() => (cart.hostelId === hostelId ? cart.lines : []), [cart, hostelId]);

  useEffect(() => {
    setCart((prev) => (prev.hostelId === hostelId ? prev : { hostelId, lines: [] }));
  }, [hostelId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    } catch {
      /* storage unavailable: cart still works for this session */
    }
  }, [cart]);

  const updateLines = useCallback(
    (fn: (prev: CartLine[]) => CartLine[]) =>
      setCart((prev) => ({ hostelId, lines: fn(prev.hostelId === hostelId ? prev.lines : []) })),
    [hostelId],
  );

  const addItem = useCallback(
    (product: Product, quantity = 1) => {
      updateLines((prev) => {
        const existing = prev.find((l) => l.product.id === product.id);
        if (existing) {
          const q = clamp(existing.quantity + quantity, product);
          return prev.map((l) => (l.product.id === product.id ? { product, quantity: q } : l));
        }
        const q = clamp(quantity, product);
        return q > 0 ? [...prev, { product, quantity: q }] : prev;
      });
    },
    [updateLines],
  );

  const setQuantity = useCallback(
    (productId: string, quantity: number) => {
      updateLines((prev) =>
        prev
          .map((l) => (l.product.id === productId ? { ...l, quantity: clamp(quantity, l.product) } : l))
          .filter((l) => l.quantity > 0),
      );
    },
    [updateLines],
  );

  const removeItem = useCallback(
    (productId: string) => updateLines((prev) => prev.filter((l) => l.product.id !== productId)),
    [updateLines],
  );

  const clearCart = useCallback(() => updateLines(() => []), [updateLines]);

  const value = useMemo<CartContextValue>(
    () => ({
      hostelId,
      lines,
      itemCount: new Set(lines.map((line) => line.product.id)).size,
      subtotal: lines.reduce((s, l) => s + l.quantity * l.product.price, 0),
      quantityOf: (id) => lines.find((l) => l.product.id === id)?.quantity ?? 0,
      addItem,
      setQuantity,
      removeItem,
      clearCart,
    }),
    [hostelId, lines, addItem, setQuantity, removeItem, clearCart],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
