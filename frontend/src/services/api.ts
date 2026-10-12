import { API_BASE_URL, apiConfigured } from './config';
import type { Product, ProductInput, StoreSettings } from '../types/product';
import type { UpdateProfileInput, UserProfile } from '../types/user';
import type {
  OrderRequest,
  OrderSummary,
  PaymentInitResponse,
  ValidateOrderResponse,
  VerifyPaymentRequest,
} from '../types/order';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type TokenProvider = () => Promise<string | null>;
let tokenProvider: TokenProvider = async () => null;

/** AuthContext registers a function that returns a fresh Firebase ID token. */
export function setTokenProvider(fn: TokenProvider) {
  tokenProvider = fn;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  formData?: FormData;
  auth?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (!apiConfigured) {
    throw new ApiError('The backend URL is not configured. Set VITE_API_BASE_URL.', 0);
  }
  const headers: Record<string, string> = {};
  if (opts.auth) {
    const token = await tokenProvider();
    if (!token) throw new ApiError('You need to sign in first.', 401);
    headers.Authorization = `Bearer ${token}`;
  }
  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData; // browser sets the multipart boundary
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { method: opts.method ?? 'GET', headers, body });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'message' in data
        ? String((data as { message: unknown }).message)
        : data && typeof data === 'object' && 'error' in data
          ? String((data as { error: unknown }).error)
          : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

/*
 * Response wrappers are UNCONFIRMED. If the backend returns { products: [...] }
 * or { data: ... } adjust the `unwrap` helpers below — nothing else needs to change.
 */
function unwrap<T>(data: unknown, key: string): T {
  if (data && typeof data === 'object' && !Array.isArray(data) && key in data) {
    return (data as Record<string, T>)[key];
  }
  return data as T;
}

export const api = {
  // Public
  getProducts: async () => unwrap<Product[]>(await request<unknown>('/api/products'), 'products'),
  getProduct: async (id: string) =>
    unwrap<Product>(await request<unknown>(`/api/products/${encodeURIComponent(id)}`), 'product'),
  getSettings: async () => unwrap<StoreSettings>(await request<unknown>('/api/settings'), 'settings'),

  // Customer
  getMe: async () => unwrap<UserProfile>(await request<unknown>('/api/users/me', { auth: true }), 'user'),
  updateMe: async (input: UpdateProfileInput) =>
    unwrap<UserProfile>(
      await request<unknown>('/api/users/me', { method: 'PUT', body: input, auth: true }),
      'user',
    ),

  // Orders & payment
  validateOrder: (body: OrderRequest) =>
    request<ValidateOrderResponse>('/api/orders/validate', { method: 'POST', body, auth: true }),
  createOrder: async (body: OrderRequest) =>
    unwrap<OrderSummary>(
      await request<unknown>('/api/orders', { method: 'POST', body, auth: true }),
      'order',
    ),
  initPayment: (orderId: string) =>
    request<PaymentInitResponse>(`/api/orders/${encodeURIComponent(orderId)}/payment`, {
      method: 'POST',
      auth: true,
    }),
  verifyPayment: async (orderId: string, body: VerifyPaymentRequest) =>
    unwrap<OrderSummary>(
      await request<unknown>(`/api/orders/${encodeURIComponent(orderId)}/payment/verify`, {
        method: 'POST',
        body,
        auth: true,
      }),
      'order',
    ),

  // Admin (backend enforces authorization)
  getAdminSettings: async () =>
    unwrap<StoreSettings>(await request<unknown>('/api/admin/settings', { auth: true }), 'settings'),
  updateAdminSettings: async (body: StoreSettings) =>
    unwrap<StoreSettings>(
      await request<unknown>('/api/admin/settings', { method: 'PUT', body, auth: true }),
      'settings',
    ),
  createProduct: (body: ProductInput) =>
    request<Product>('/api/admin/products', { method: 'POST', body, auth: true }),
  updateProduct: (id: string, body: ProductInput) =>
    request<Product>(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'PUT', body, auth: true }),
  deleteProduct: (id: string) =>
    request<unknown>(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true }),
  /** UNCONFIRMED: multipart field name ("image") and response ({ imageUrl } or { url }). */
  uploadProductImage: async (file: File): Promise<string> => {
    const fd = new FormData();
    fd.append('image', file);
    const data = await request<{ imageUrl?: string; url?: string }>('/api/admin/products/images', {
      method: 'POST',
      formData: fd,
      auth: true,
    });
    const url = data.imageUrl ?? data.url;
    if (!url) throw new ApiError('Upload succeeded but no image URL was returned.', 500);
    return url;
  },
};
