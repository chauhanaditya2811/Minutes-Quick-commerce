import type { PaymentInitResponse, VerifyPaymentRequest } from '../types/order';

interface CashfreeInstance {
  checkout: (options: { paymentSessionId: string; redirectTarget?: '_modal' | '_self' }) => Promise<unknown> | void;
}

declare global {
  interface Window {
    Cashfree?: (options: { mode: 'sandbox' | 'production' }) => CashfreeInstance;
  }
}

const SCRIPT_SRC = 'https://sdk.cashfree.com/js/v3/cashfree.js';

function loadScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Cashfree) return resolve(true);
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export type CashfreeOutcome =
  | { status: 'success'; payload: VerifyPaymentRequest }
  | { status: 'dismissed' }
  | { status: 'failed'; message: string };

export async function openCashfree(init: PaymentInitResponse): Promise<CashfreeOutcome> {
  if (!(await loadScript()) || !window.Cashfree) {
    return { status: 'failed', message: 'Could not load Cashfree. Check your connection and try again.' };
  }
  try {
    const result = await window.Cashfree({
      mode: import.meta.env.VITE_CASHFREE_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
    }).checkout({ paymentSessionId: init.paymentSessionId, redirectTarget: '_modal' });
    if (result && typeof result === 'object' && 'error' in result) {
      return { status: 'failed', message: 'The payment could not be completed.' };
    }
    return { status: 'success', payload: { cashfree_order_id: init.cashfreeOrderId } };
  } catch {
    return { status: 'dismissed' };
  }
}
