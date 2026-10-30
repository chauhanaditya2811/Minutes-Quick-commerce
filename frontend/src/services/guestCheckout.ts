import type { GuestCustomerInput } from '../types/order';

/**
 * Browser-side state for guest checkout. A guest order is reachable only with its secret
 * token, so the token is kept on this device: the in-progress checkout in sessionStorage
 * (survives a refresh in this tab) and placed orders in localStorage (for the order page).
 */

const PENDING_KEY = 'minutes.guestCheckout.pending.v1';
const DETAILS_KEY = 'minutes.guestCheckout.details.v1';
const ORDERS_KEY = 'minutes.guestOrders.v1';
const HOSTELS_KEY = 'minutes.guestHostels.v1';
const MAX_REMEMBERED_ORDERS = 20;

/** A 256-bit random secret, base64url encoded (43 characters). */
export function newCheckoutToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function read<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: unknown) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: checkout still works for this page view */
  }
}

/** The unpaid guest order this tab created, reused for retries so no duplicate is placed. */
export interface PendingGuestCheckout {
  /** Identifies the cart and details the order was created for. */
  cartKey: string;
  orderId: string;
  orderNumber: string;
  token: string;
  cashfreeOrderId?: string;
}

export const loadPendingCheckout = () => read<PendingGuestCheckout>(sessionStorage, PENDING_KEY);
export const savePendingCheckout = (pending: PendingGuestCheckout | null) => write(sessionStorage, PENDING_KEY, pending);

export const loadGuestDetails = () => read<Partial<Record<keyof GuestCustomerInput, string>>>(sessionStorage, DETAILS_KEY);
export const saveGuestDetails = (details: Record<keyof GuestCustomerInput, string>) => write(sessionStorage, DETAILS_KEY, details);

/** The hostel a guest last chose in each pool on this device, so checkout can pre-fill it. */
export const loadGuestHostel = (poolId: string) => read<Record<string, string>>(localStorage, HOSTELS_KEY)?.[poolId] ?? '';
export const saveGuestHostel = (poolId: string, hostelId: string) =>
  write(localStorage, HOSTELS_KEY, { ...(read<Record<string, string>>(localStorage, HOSTELS_KEY) ?? {}), [poolId]: hostelId });

/** A guest order placed on this device, so its page can be reopened. */
export interface RememberedGuestOrder {
  orderId: string;
  token: string;
  orderNumber: string;
  cashfreeOrderId?: string;
}

const loadOrders = () => read<RememberedGuestOrder[]>(localStorage, ORDERS_KEY) ?? [];

export const findGuestOrder = (orderId: string) => loadOrders().find((order) => order.orderId === orderId) ?? null;

export function rememberGuestOrder(order: RememberedGuestOrder) {
  const others = loadOrders().filter((existing) => existing.orderId !== order.orderId);
  const previous = findGuestOrder(order.orderId);
  write(localStorage, ORDERS_KEY, [{ ...previous, ...order }, ...others].slice(0, MAX_REMEMBERED_ORDERS));
}
