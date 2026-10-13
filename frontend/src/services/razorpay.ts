import type { PaymentInitResponse, VerifyPaymentRequest } from '../types/order';

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color: string };
  handler: (r: RazorpaySuccess) => void;
  modal?: { ondismiss?: () => void };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: 'payment.failed', cb: (r: { error: { description?: string } }) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

function loadScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export type RazorpayOutcome =
  | { status: 'success'; payload: VerifyPaymentRequest }
  | { status: 'dismissed' }
  | { status: 'failed'; message: string };

/**
 * Opens Razorpay Checkout. A "success" outcome is NOT proof of payment —
 * the payload must be sent to the backend verification endpoint.
 */
export async function openRazorpay(
  init: PaymentInitResponse,
  prefill: { name?: string; email?: string; contact?: string },
): Promise<RazorpayOutcome> {
  if (!(await loadScript()) || !window.Razorpay) {
    return { status: 'failed', message: 'Could not load Razorpay. Check your connection and try again.' };
  }
  const Razorpay = window.Razorpay;
  return new Promise<RazorpayOutcome>((resolve) => {
    const rzp = new Razorpay({
      key: init.keyId,
      amount: init.amount,
      currency: init.currency,
      order_id: init.razorpayOrderId,
      name: 'Minutes',
      description: 'Hostel delivery order',
      prefill,
      theme: { color: '#5145E5' },
      handler: (r) =>
        resolve({
          status: 'success',
          payload: {
            razorpay_order_id: r.razorpay_order_id,
            razorpay_payment_id: r.razorpay_payment_id,
            razorpay_signature: r.razorpay_signature,
          },
        }),
      modal: { ondismiss: () => resolve({ status: 'dismissed' }) },
    });
    rzp.on('payment.failed', (r) =>
      resolve({ status: 'failed', message: r.error.description ?? 'The payment failed.' }),
    );
    rzp.open();
  });
}
