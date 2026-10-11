import Razorpay from "razorpay";

// Raised when required Razorpay credentials are missing.
export class RazorpayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RazorpayConfigError";
  }
}

// Public key ID: this may be shared with the checkout frontend.
export const getRazorpayKeyId = (): string => {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();

  if (!keyId) {
    throw new RazorpayConfigError(
      "Razorpay Key ID is not configured."
    );
  }

  return keyId;
};

// Private API secret: only server-side code may access this.
export const getRazorpayKeySecret = (): string => {
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

  if (!keySecret) {
    throw new RazorpayConfigError(
      "Razorpay Key Secret is not configured."
    );
  }

  return keySecret;
};

// Create the SDK client only when a payment operation needs it.
export const getRazorpayClient = (): Razorpay => {
  return new Razorpay({
    key_id: getRazorpayKeyId(),
    key_secret: getRazorpayKeySecret(),
  });
};

// Read the secret configured for Razorpay webhook signature verification.
export const getRazorpayWebhookSecret = (): string => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();

  if (!secret) {
    throw new RazorpayConfigError(
      "Razorpay Webhook Secret is not configured."
    );
  }

  return secret;
};