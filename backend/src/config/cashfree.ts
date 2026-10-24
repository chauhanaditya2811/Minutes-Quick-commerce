export class CashfreeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CashfreeConfigError";
  }
}

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new CashfreeConfigError(`${name} is not configured.`);
  }
  return value;
};

export const getCashfreeClientId = () => required("CASHFREE_CLIENT_ID");
export const getCashfreeClientSecret = () => required("CASHFREE_CLIENT_SECRET");
export const getCashfreeWebhookSecret = () => required("CASHFREE_CLIENT_SECRET");

export const getCashfreeApiBaseUrl = () =>
  process.env.CASHFREE_ENVIRONMENT?.trim().toLowerCase() === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";

export const CASHFREE_API_VERSION = "2026-01-01";
