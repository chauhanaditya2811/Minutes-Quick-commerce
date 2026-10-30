import { newCheckoutToken } from './guestCheckout';

const KEY = 'minutes.voterToken.v1';
let fallback: string | null = null;

/**
 * A random token that identifies this browser for upvotes (one vote per request per device).
 * Kept in localStorage; if storage is blocked it lasts for this page view only.
 */
export function getVoterToken(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && /^[A-Za-z0-9_-]{43,128}$/.test(saved)) return saved;
    const token = newCheckoutToken();
    localStorage.setItem(KEY, token);
    return token;
  } catch {
    fallback ??= newCheckoutToken();
    return fallback;
  }
}
