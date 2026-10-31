import { API_BASE_URL, apiConfigured } from './config';
import type {
  AdminProduct,
  HostelStock,
  HostelStockUpdateEntry,
  Product,
  ProductInput,
  StockGroup,
  StoreSettings,
  StoreSettingsUpdate,
} from '../types/product';
import type { UpdateProfileInput, UserProfile } from '../types/user';
import type {
  AdminFeedback,
  AdminProductRequests,
  CreateProductRequestResponse,
  FeedbackInput,
  FeedbackStatus,
  ProductRequest,
  ProductRequestBoard,
  ProductRequestStatus,
} from '../types/feedback';
import { getVoterToken } from './voter';
import type {
  OrderRequest,
  OrderSummary,
  AdminOrder,
  CustomerOrder,
  PaymentInitResponse,
  GuestOrderRequest,
  OrderDetailResponse,
  GuestPlacedOrder,
  GuestValidateRequest,
  ValidateOrderResponse,
  VerifyPaymentRequest,
  VerifyPaymentResponse,
} from '../types/order';

/** Guest orders are reachable only with their secret checkout token, sent in this header. */
const guestHeaders = (token: string) => ({ 'X-Guest-Order-Token': token });
/** Upvotes are counted once per device, identified by this random token. */
const voterHeaders = () => ({ 'X-Voter-Token': getVoterToken() });

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** A hostel. Hostels with the same stockGroupId (pool) share one stock. */
export interface Hostel { id: string; name: string; stockGroupId?: string; }
/** Where customers shop: one shared stock ("Boys' Hostels") and the active hostels it serves. */
export interface Pool { id: string; name: string; hostels: { id: string; name: string }[]; }
export interface AdminHostel extends Hostel {
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  stockGroup?: { id: string; name: string };
}

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
  headers?: Record<string, string>;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (!apiConfigured) {
    throw new ApiError('The backend URL is not configured. Set VITE_API_BASE_URL.', 0);
  }
  const headers: Record<string, string> = { ...opts.headers };
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
  getPools: () => request<Pool[]>('/api/pools'),
  getProducts: (poolId: string) =>
    request<Product[]>(`/api/products?poolId=${encodeURIComponent(poolId)}`),
  getProduct: (id: string, poolId: string) =>
    request<Product>(`/api/products/${encodeURIComponent(id)}?poolId=${encodeURIComponent(poolId)}`),
  getSettings: () => request<StoreSettings>('/api/settings'),
  getHostels: () => request<Hostel[]>('/api/hostels'),

  // Product requests and feedback (no sign-in needed)
  getProductRequests: (poolId: string) =>
    request<ProductRequestBoard>(`/api/product-requests?poolId=${encodeURIComponent(poolId)}`, { headers: voterHeaders() }),
  requestProduct: (poolId: string, name: string) =>
    request<CreateProductRequestResponse>('/api/product-requests', { method: 'POST', body: { poolId, name }, headers: voterHeaders() }),
  setProductRequestVote: async (id: string, voted: boolean) =>
    envelopeValue<ProductRequest>(
      await request<unknown>(`/api/product-requests/${encodeURIComponent(id)}/vote`, { method: voted ? 'PUT' : 'DELETE', headers: voterHeaders() }),
      'request',
    ),
  sendFeedback: (input: FeedbackInput) => request<unknown>('/api/feedback', { method: 'POST', body: input }),

  // Customer
  getMe: () => request<UserProfile>('/api/users/me', { auth: true }),
  updateMe: (input: UpdateProfileInput) =>
    request<UserProfile>('/api/users/me', { method: 'PUT', body: input, auth: true }),

  // Orders & payment
  getMyOrder: (orderId: string) =>
    request<OrderDetailResponse>(`/api/orders/${encodeURIComponent(orderId)}`, { auth: true }),
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

  // Guest checkout (no sign-in; each order is gated by its own secret token)
  validateGuestOrder: (body: GuestValidateRequest) =>
    request<ValidateOrderResponse>('/api/guest/checkout/validate', { method: 'POST', body }),
  createGuestOrder: async (body: GuestOrderRequest) =>
    envelopeValue<GuestPlacedOrder>(await request<unknown>('/api/guest/orders', { method: 'POST', body }), 'order'),
  getGuestOrder: (orderId: string, token: string) =>
    request<OrderDetailResponse>(`/api/guest/orders/${encodeURIComponent(orderId)}`, { headers: guestHeaders(token) }),
  initGuestPayment: async (orderId: string, token: string) =>
    envelopeValue<PaymentInitResponse>(
      await request<unknown>(`/api/guest/orders/${encodeURIComponent(orderId)}/payment`, {
        method: 'POST',
        headers: guestHeaders(token),
      }),
      'payment',
    ),
  verifyGuestPayment: async (orderId: string, token: string, body: VerifyPaymentRequest) =>
    envelopeValue<VerifyPaymentResponse>(
      await request<unknown>(`/api/guest/orders/${encodeURIComponent(orderId)}/payment/verify`, {
        method: 'POST',
        body,
        headers: guestHeaders(token),
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
  getAdminProductRequests: (status: ProductRequestStatus, poolId?: string) =>
    request<AdminProductRequests>(
      `/api/admin/feedback/product-requests?status=${status}${poolId ? `&poolId=${encodeURIComponent(poolId)}` : ''}`,
      { auth: true },
    ),
  updateProductRequestStatus: (id: string, status: ProductRequestStatus) =>
    request<unknown>(`/api/admin/feedback/product-requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status }, auth: true }),
  deleteProductRequest: (id: string) =>
    request<unknown>(`/api/admin/feedback/product-requests/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true }),
  getAdminFeedback: (status: FeedbackStatus) =>
    request<AdminFeedback>(`/api/admin/feedback/messages?status=${status}`, { auth: true }),
  updateFeedbackStatus: (id: string, status: FeedbackStatus) =>
    request<unknown>(`/api/admin/feedback/messages/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status }, auth: true }),
  getAdminHostels: () => request<AdminHostel[]>('/api/admin/hostels', { auth: true }),
  createHostel: (name: string, stockGroupId?: string) =>
    request<AdminHostel>('/api/admin/hostels', { method: 'POST', body: { name, ...(stockGroupId ? { stockGroupId } : {}) }, auth: true }),
  getStockGroups: () => request<StockGroup[]>('/api/admin/stock-groups', { auth: true }),
  /** Creates a pool; `copyStockFromHostelId` starts its stock as a copy of that hostel's current stock. */
  createStockGroup: (name: string, hostelIds: string[], copyStockFromHostelId?: string) =>
    request<StockGroup>('/api/admin/stock-groups', {
      method: 'POST',
      body: { name, hostelIds, ...(copyStockFromHostelId ? { copyStockFromHostelId } : {}) },
      auth: true,
    }),
  /** Moves a hostel into a pool, or (with no pool) into a new empty pool of its own. */
  moveHostelToPool: (hostelId: string, stockGroupId: string | null) =>
    request<AdminHostel>(`/api/admin/hostels/${encodeURIComponent(hostelId)}/pool`, {
      method: 'PATCH',
      body: stockGroupId ? { stockGroupId } : {},
      auth: true,
    }),
  updateStockGroup: (id: string, body: { name?: string; hostelIds?: string[] }) =>
    request<StockGroup>(`/api/admin/stock-groups/${encodeURIComponent(id)}`, { method: 'PATCH', body, auth: true }),
  deleteStockGroup: (id: string) =>
    request<void>(`/api/admin/stock-groups/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true }),
  activateHostel: (id: string) => request<AdminHostel>(`/api/admin/hostels/${encodeURIComponent(id)}/activate`, { method: 'PATCH', auth: true }),
  deactivateHostel: (id: string) => request<AdminHostel>(`/api/admin/hostels/${encodeURIComponent(id)}/deactivate`, { method: 'PATCH', auth: true }),
  permanentlyDeleteHostel: (id: string) =>
    request<void>(`/api/admin/hostels/${encodeURIComponent(id)}/permanent`, { method: 'DELETE', auth: true }),
  updateAdminSettings: (body: StoreSettingsUpdate) =>
    request<StoreSettings>('/api/admin/settings', { method: 'PUT', body, auth: true }),
  getAdminProducts: () => request<AdminProduct[]>('/api/admin/products', { auth: true }),
  getGroupStock: (stockGroupId: string) =>
    request<HostelStock>(`/api/admin/stock-groups/${encodeURIComponent(stockGroupId)}/inventory`, { auth: true }),
  updateGroupStock: (stockGroupId: string, entries: HostelStockUpdateEntry[]) =>
    request<HostelStock>(`/api/admin/stock-groups/${encodeURIComponent(stockGroupId)}/inventory`, {
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
