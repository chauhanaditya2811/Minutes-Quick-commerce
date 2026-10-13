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
  customerName: string;
  customerEmail: string;
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
  items: {
    productName: string;
    price: number;
    unit: string;
    quantity: number;
    subtotal: number;
  }[];
}

/** POST /api/orders/:orderId/payment — enough to open Razorpay Checkout. */
export interface PaymentInitResponse {
  orderId: string;
  paymentAttemptId: string;
  razorpayOrderId: string;
  amount: number; // as returned by the backend (Razorpay expects paise)
  currency: string;
  keyId: string; // public Razorpay Key ID
}

/** Body for POST /api/orders/:orderId/payment/verify. */
export interface VerifyPaymentRequest {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

/** The `payment` payload returned after server-side payment verification. */
export interface VerifyPaymentResponse {
  orderId: string;
  orderNumber: string;
  paymentAttemptId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  paymentStatus: 'SUCCESS';
  orderStatus: 'CONFIRMED' | 'DELIVERED';
}
