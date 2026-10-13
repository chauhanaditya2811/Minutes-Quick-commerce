function getErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

export function getAuthErrorMessage(error: unknown, fallback: string): string {
  if (getErrorCode(error) === 'auth/unauthorized-domain') {
    const hostname = typeof window === 'undefined' ? 'this hostname' : window.location.hostname;
    return `Google sign-in is blocked for ${hostname}. Add this hostname in Firebase Console → Authentication → Settings → Authorized domains (do not include the port), then reload the app.`;
  }

  return error instanceof Error ? error.message : fallback;
}
