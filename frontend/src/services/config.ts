export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
export const apiConfigured = API_BASE_URL !== '';

/**
 * Preview mode: no backend URL AND running under `npm run dev`.
 * Production builds never use mock data — they show an error instead.
 */
export const previewMode = !apiConfigured && import.meta.env.DEV;
