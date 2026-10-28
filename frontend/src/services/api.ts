import { API_BASE_URL, apiConfigured } from './config';
import type {
  AdminProduct,
  InventoryUpdateEntry,
  Product,
  ProductInput,
  ProductInventory,
  StoreSettings,
} from '../types/product';
import type { UpdateProfileInput, UserProfile } from '../types/user';
import type {
  OrderRequest,
  OrderSummary,
  AdminOrder,
  CustomerOrder,
  PaymentInitResponse,
  ValidateOrderResponse,
  VerifyPaymentRequest,
  VerifyPaymentResponse,
} from '../types/order';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface Hostel { id: string; name: string; }
export interface AdminHostel extends Hostel { isActive: boolean; createdAt: string; updatedAt: string; }

type TokenProvider = () => Promise<string | null>;
let tokenProvider: TokenProvider = async () => null;

/** AuthContext registers a function that returns a fresh Firebase ID token. */
export function setTokenProvider(fn: TokenProvider) {
  tokenProvider = fn;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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

function envelopeValue<T>(data: unknown, key: string): T {
  if (data && typeof data === 'object' && !Array.isArray(data) && key in data) {
    return (data as Record<string, T>)[key];
  }
  throw new ApiError(`The server response did not include "${key}".`, 502);
}

interface BackendOrder {
  id: string;
  orderNumber: string;
  orderStatus: OrderSummary['status'];
  paymentStatus: NonNullable<OrderSummary['paymentStatus']>;
  subtotal: number;
  deliveryFee: number;
  total: number;
  createdAt: string;
  items: {
    productId: string;
    productName: string;
    quantity: number;
    price: number;
  }[];
}

function mapOrder(order: BackendOrder): OrderSummary {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.orderStatus,
    paymentStatus: order.paymentStatus,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      productId: item.productId,
      name: item.productName,
      quantity: item.quantity,
      price: item.price,
    })),
  };
}

export const api = {
  // Public
  getProducts: (hostelId: string) =>
    request<Product[]>(`/api/products?hostelId=${encodeURIComponent(hostelId)}`),
  getProduct: (id: string, hostelId: string) =>
    request<Product>(`/api/products/${encodeURIComponent(id)}?hostelId=${encodeURIComponent(hostelId)}`),
  getSettings: () => request<StoreSettings>('/api/settings'),
  getHostels: () => request<Hostel[]>('/api/hostels'),

  // Customer
  getMe: () => request<UserProfile>('/api/users/me', { auth: true }),
  updateMe: (input: UpdateProfileInput) =>
    request<UserProfile>('/api/users/me', { method: 'PUT', body: input, auth: true }),

  // Orders & payment
  getMyOrders: async () =>
    envelopeValue<CustomerOrder[]>(await request<unknown>('/api/orders/my', { auth: true }), 'orders'),
  validateOrder: (body: OrderRequest) =>
    request<ValidateOrderResponse>('/api/orders/validate', { method: 'POST', body, auth: true }),
  createOrder: async (body: OrderRequest) =>
    mapOrder(
      envelopeValue<BackendOrder>(
        await request<unknown>('/api/orders', { method: 'POST', body, auth: true }),
        'order',
      ),
    ),
  initPayment: async (orderId: string) =>
    envelopeValue<PaymentInitResponse>(
      await request<unknown>(`/api/orders/${encodeURIComponent(orderId)}/payment`, {
        method: 'POST',
        auth: true,
      }),
      'payment',
    ),
  verifyPayment: async (orderId: string, body: VerifyPaymentRequest) =>
    envelopeValue<VerifyPaymentResponse>(
      await request<unknown>(`/api/orders/${encodeURIComponent(orderId)}/payment/verify`, {
        method: 'POST',
        body,
        auth: true,
      }),
      'payment',
    ),

  // Admin (backend enforces authorization)
  getAdminOrders: async () =>
    envelopeValue<AdminOrder[]>(await request<unknown>('/api/admin/orders', { auth: true }), 'orders'),
  markAdminOrderDelivered: async (orderId: string) =>
    envelopeValue<AdminOrder>(
      await request<unknown>(`/api/admin/orders/${encodeURIComponent(orderId)}/status`, {
        method: 'PATCH',
        body: { status: 'DELIVERED' },
        auth: true,
      }),
      'order',
    ),
  getAdminSettings: () => request<StoreSettings>('/api/admin/settings', { auth: true }),
  getAdminHostels: () => request<AdminHostel[]>('/api/admin/hostels', { auth: true }),
  createHostel: (name: string) => request<AdminHostel>('/api/admin/hostels', { method: 'POST', body: { name }, auth: true }),
  activateHostel: (id: string) => request<AdminHostel>(`/api/admin/hostels/${encodeURIComponent(id)}/activate`, { method: 'PATCH', auth: true }),
  deactivateHostel: (id: string) => request<AdminHostel>(`/api/admin/hostels/${encodeURIComponent(id)}/deactivate`, { method: 'PATCH', auth: true }),
  permanentlyDeleteHostel: (id: string) =>
    request<void>(`/api/admin/hostels/${encodeURIComponent(id)}/permanent`, { method: 'DELETE', auth: true }),
  updateAdminSettings: (body: StoreSettings) =>
    request<StoreSettings>('/api/admin/settings', { method: 'PUT', body, auth: true }),
  getAdminProducts: () => request<AdminProduct[]>('/api/admin/products', { auth: true }),
  getProductInventory: (id: string) =>
    request<ProductInventory>(`/api/admin/products/${encodeURIComponent(id)}/inventory`, { auth: true }),
  updateProductInventory: (id: string, entries: InventoryUpdateEntry[]) =>
    request<ProductInventory>(`/api/admin/products/${encodeURIComponent(id)}/inventory`, {
      method: 'PUT',
      body: { entries },
      auth: true,
    }),
  createProduct: (body: ProductInput) =>
    request<Product>('/api/admin/products', { method: 'POST', body, auth: true }),
  updateProduct: (id: string, body: ProductInput) =>
    request<Product>(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'PUT', body, auth: true }),
  deleteProduct: (id: string) =>
    request<unknown>(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true }),
  uploadProductImage: async (file: File): Promise<string> => {
    const fd = new FormData();
    fd.append('image', file);
    const data = await request<{ imageUrl: string; publicId: string }>('/api/admin/products/images', {
      method: 'POST',
      formData: fd,
      auth: true,
    });
    if (!data.imageUrl) throw new ApiError('Upload succeeded but no image URL was returned.', 502);
    return data.imageUrl;
  },
};
