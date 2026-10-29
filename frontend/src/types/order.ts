export type OrderStatus = 'PENDING_PAYMENT' | 'CONFIRMED' | 'DELIVERED' | 'CANCELLED';
export type PaymentStatus = 'CREATED' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'REFUNDED';

export interface OrderItemInput {
  productId: string;
  quantity: number;
}

/** Body for POST /api/orders/validate and POST /api/orders. */
export interface OrderRequest {
  hostelId: string; // store hostel; must match the profile's delivery hostel
  items: OrderItemInput[];
}

export interface CheckoutItem {
  productId: string;
  productName: string;
  price: number;
  unit: string;
  quantity: number;
  subtotal: number;
}

/** The `checkout` payload returned by POST /api/orders/validate. */
export interface ValidateOrderResponse {
  message: string;
  checkout: {
    customer: {
      id: string;
      name: string;
      email: string | null;
      image: string | null;
      phone: string;
      hostel: string;
      floor: number;
      room: string;
    };
    items: CheckoutItem[];
    subtotal: number;
    deliveryFee: number;
    total: number;
  };
}

export interface OrderSummary {
  id: string;
  orderNumber?: string;
  status: OrderStatus;
  paymentStatus?: PaymentStatus;
  subtotal?: number;
  deliveryFee?: number;
  total: number;
  createdAt?: string;
  items?: { productId?: string; name: string; quantity: number; price: number }[];
}

/** A customer-visible order record returned by GET /api/orders/my. */
export interface CustomerOrder {
  orderNumber: string;
  createdAt: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotal: number;
  deliveryFee: number;
  total: number;
  items: {
    productName: string;
    price: number;
    unit: string;
    quantity: number;
    subtotal: number;
  }[];
}

/** Admin order record returned by GET /api/admin/orders. */
export interface AdminOrder {
  id: string;
  orderNumber: string;
  /** null for guest orders placed without an account. */
  userId: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string;
  customerHostel: string;
  customerFloor: number;
  customerRoom: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  createdAt: string;
  deliveredAt: string | null;
  /** A late payment found less stock than ordered at the hostel; needs manual follow-up. */
  inventoryShortfall?: boolean;
  /** Cashfree references for reconciliation, once a payment was started. */
  payment?: { cashfreeOrderId: string | null; cashfreePaymentId: string | null } | null;
  items: {
    productName: string;
    price: number;
    unit: string;
    quantity: number;
    subtotal: number;
  }[];
}

/** POST /api/orders/:orderId/payment — enough to open Cashfree Checkout. */
export interface PaymentInitResponse {
  orderId: string;
  paymentAttemptId: string;
  cashfreeOrderId: string;
  paymentSessionId: string;
  amount: number;
  currency: string;
  clientId: string;
  /** When the stock held for this order is released if payment hasn't completed. */
  holdExpiresAt?: string | null;
}

/** Body for POST /api/orders/:orderId/payment/verify. */
export interface VerifyPaymentRequest {
  cashfree_order_id: string;
}

/** The `payment` payload returned after server-side payment verification. */
export interface VerifyPaymentResponse {
  orderId: string;
  orderNumber: string;
  paymentAttemptId: string;
  paymentStatus: 'SUCCESS';
  orderStatus: 'CONFIRMED' | 'DELIVERED';
}

/** Delivery details a guest enters at checkout (no account, no email). */
export interface GuestCustomerInput {
  name: string;
  phone: string;
  floor: number;
  room: string;
}

/** Body for POST /api/guest/checkout/validate. Only IDs and quantities are sent; prices come from the server. */
export interface GuestValidateRequest {
  hostelId: string;
  items: OrderItemInput[];
  customer: GuestCustomerInput;
}

/** Body for POST /api/guest/orders. */
export interface GuestOrderRequest extends GuestValidateRequest {
  /** 256-bit random secret from this browser: owns the order and makes retries idempotent. */
  checkoutToken: string;
  /** The guest's earlier unpaid order to release, when the cart or details changed. */
  replacesOrder?: { orderId: string; checkoutToken: string };
}

/** The order returned by POST /api/guest/orders. */
export interface GuestPlacedOrder {
  id: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotal: number;
  deliveryFee: number;
  total: number;
  createdAt: string;
  holdExpiresAt: string | null;
  items: { productId: string; productName: string; price: number; unit: string; quantity: number; subtotal: number }[];
}

/**
 * A customer's own order for the confirmation screen (phone masked): from
 * GET /api/guest/orders/:orderId (guests) or GET /api/orders/:orderId (signed in).
 */
export interface GuestOrder {
  id: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotal: number;
  deliveryFee: number;
  total: number;
  createdAt: string;
  /** When payment was verified; the 10-minute delivery countdown runs from here. */
  confirmedAt: string | null;
  deliveredAt: string | null;
  customerName: string;
  customerPhone: string;
  customerHostel: string;
  customerFloor: number;
  customerRoom: string;
  items: {
    productName: string;
    price: number;
    unit: string;
    quantity: number;
    subtotal: number;
    /** Current product photo, for the confirmation screen. */
    product?: { imageUrl: string } | null;
  }[];
}

export type OrderDetail = GuestOrder;

/** An order detail plus the server's clock, used to correct the countdown for device clock skew. */
export interface OrderDetailResponse {
  order: OrderDetail;
  serverTime: string;
}
