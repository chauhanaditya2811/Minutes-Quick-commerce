import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { ApiError, api } from '../services/api';
import Loading from '../components/Loading';
import Notice from '../components/ui/Notice';
import { GoogleIcon } from '../components/ui/Icons';
import { getAuthErrorMessage } from '../utils/authError';

type AccessState =
  | { uid: string; status: 'checking' | 'allowed' | 'denied' }
  | { uid: string; status: 'error'; message: string };

export default function AdminRoute({ children }: { children: ReactNode }) {
  const { firebaseConfigured, firebaseUser, loading, signInWithGoogle, signOut } = useAuth();
  const [access, setAccess] = useState<AccessState | null>(null);
  const [retry, setRetry] = useState(0);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    const uid = firebaseUser.uid;
    let cancelled = false;
    setAccess({ uid, status: 'checking' });
    setAuthError(null);

    api
      .getAdminSettings()
      .then(() => {
        if (!cancelled) setAccess({ uid, status: 'allowed' });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          setAccess({ uid, status: 'denied' });
          return;
        }
        setAccess({
          uid,
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not verify administrator access.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [firebaseUser, retry]);

  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (error) {
      setAuthError(getAuthErrorMessage(error, 'Google sign-in failed. Please try again.'));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    setLogoutBusy(true);
    setLogoutError(null);
    try {
      await signOut();
      setAccess(null);
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'Could not sign out. Please try again.');
    } finally {
      setLogoutBusy(false);
    }
  };

  const handleRetry = () => {
    if (firebaseUser) setAccess({ uid: firebaseUser.uid, status: 'checking' });
    setRetry((value) => value + 1);
  };

  if (loading) {
    return <main className="admin-screen"><Loading label="Checking sign-in…" /></main>;
  }

  if (!firebaseUser) {
    return (
      <main className="admin-screen">
        <section className="admin-login panel">
          <div className="admin-login__brand">Minutes</div>
          <span className="admin-login__eyebrow">RESTRICTED AREA</span>
          <h1>Admin Sign In</h1>
          <p className="muted">Sign in with your Google account to verify administrator access.</p>
          {!firebaseConfigured && (
            <Notice tone="warning">Firebase sign-in is not configured for this environment.</Notice>
          )}
          {authError && <Notice tone="error">{authError}</Notice>}
          <button
            type="button"
            className="btn btn--navy btn--block admin-login__button"
            disabled={!firebaseConfigured || authBusy}
            onClick={() => void handleGoogleSignIn()}
          >
            {authBusy ? <><span className="spinner admin-login__spinner" aria-hidden="true" /> Signing in…</> : <><GoogleIcon width={18} height={18} /> Continue with Google</>}
          </button>
          <p className="admin-login__footnote">Administrator access is verified securely before the dashboard is shown.</p>
        </section>
      </main>
    );
  }

  const currentAccess = access?.uid === firebaseUser.uid ? access : null;
  if (!currentAccess || currentAccess.status === 'checking') {
    return (
      <main className="admin-screen">
        <section className="admin-state panel">
          <div className="admin-login__brand">Minutes</div>
          <Loading label="Verifying administrator access…" />
        </section>
      </main>
    );
  }

  if (currentAccess.status === 'denied') {
    return (
      <main className="admin-screen">
        <section className="admin-state panel">
          <div className="admin-login__brand">Minutes</div>
          <h1>Access Denied</h1>
          <p className="muted">This Google account is not authorized to access the admin dashboard.</p>
          <div className="admin-state__actions">
            <button type="button" className="btn btn--outline" onClick={handleRetry}>Try again</button>
            <button type="button" className="btn btn--navy" disabled={logoutBusy} onClick={() => void handleLogout()}>
              {logoutBusy ? 'Signing out…' : 'Sign out and try another account'}
            </button>
          </div>
          {logoutError && <Notice tone="error">{logoutError}</Notice>}
        </section>
      </main>
    );
  }

  if (currentAccess.status === 'error') {
    return (
      <main className="admin-screen">
        <section className="admin-state panel">
          <div className="admin-login__brand">Minutes</div>
          <h1>Couldn’t verify access</h1>
          <Notice tone="error">{currentAccess.message}</Notice>
          <div className="admin-state__actions">
            <button type="button" className="btn btn--indigo" onClick={handleRetry}>Retry verification</button>
            <button type="button" className="btn btn--outline" disabled={logoutBusy} onClick={() => void handleLogout()}>
              {logoutBusy ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
          {logoutError && <Notice tone="error">{logoutError}</Notice>}
        </section>
      </main>
    );
  }

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div className="admin-header__inner">
          <span className="admin-header__brand">Minutes</span>
          <span className="admin-header__label">Admin console</span>
          <button type="button" className="btn btn--outline admin-header__logout" disabled={logoutBusy} onClick={() => void handleLogout()}>
            {logoutBusy ? 'Signing out…' : 'Logout'}
          </button>
        </div>
      </header>
      {logoutError && <div className="container"><Notice tone="error">{logoutError}</Notice></div>}
      <main className="admin-main">
        <div className="container">{children}</div>
      </main>
    </div>
  );
}
