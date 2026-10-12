export type OrderStatus = 'PENDING_PAYMENT' | 'CONFIRMED' | 'DELIVERED' | 'CANCELLED';
export type PaymentStatus = 'CREATED' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'REFUNDED';

export interface OrderItemInput {
  productId: string;
  quantity: number;
}

/** Body for POST /api/orders/validate and POST /api/orders. */
export interface OrderRequest {
  items: OrderItemInput[];
}

/*
 * UNCONFIRMED response shapes. The backend contract has not been shared yet.
 * Every field except `total` is optional so the UI degrades gracefully.
 * Confirm against the real controllers before integration.
 */
export interface ValidateOrderResponse {
  subtotal?: number;
  deliveryFee?: number;
  total: number;
}

export interface OrderSummary {
  id: string;
  status: OrderStatus;
  paymentStatus?: PaymentStatus;
  subtotal?: number;
  deliveryFee?: number;
  total: number;
  createdAt?: string;
  items?: { productId?: string; name: string; quantity: number; price: number }[];
}

/** POST /api/orders/:orderId/payment — enough to open Razorpay Checkout. */
export interface PaymentInitResponse {
  razorpayOrderId: string;
  amount: number; // as returned by the backend (Razorpay expects paise)
  currency: string;
  keyId: string; // public Razorpay Key ID
}

/** Body for POST /api/orders/:orderId/payment/verify. */
export interface VerifyPaymentRequest {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}
