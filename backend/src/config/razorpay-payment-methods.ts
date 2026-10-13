// Razorpay Standard Checkout methods that Minutes currently accepts.
// Keep this list explicit: enabling a method requires a deliberate review.
export const SUPPORTED_RAZORPAY_PAYMENT_METHODS = new Set([
  "upi",
  "card",
  "netbanking",
  "wallet",
]);

export const isSupportedRazorpayPaymentMethod = (
  method: unknown
): method is string =>
  typeof method === "string" &&
  SUPPORTED_RAZORPAY_PAYMENT_METHODS.has(method);
