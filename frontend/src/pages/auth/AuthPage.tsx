import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { GoogleIcon } from '../../components/ui/Icons';
import Notice from '../../components/ui/Notice';
import { getAuthErrorMessage } from '../../utils/authError';

type AuthMode = 'login' | 'register' | 'reset-password';

function friendly(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : '';

  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(code))
    return 'Email or password is incorrect.';
  if (code === 'auth/user-disabled') return 'This account has been disabled. Contact support for help.';
  if (code === 'auth/invalid-email') return 'Enter a valid email address.';
  if (code === 'auth/network-request-failed') return 'Network error. Check your connection and try again.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a while and try again.';
  if (code === 'auth/email-already-in-use') return 'An account with this email already exists. Try signing in.';
  if (code === 'auth/weak-password') return 'Choose a password with at least 6 characters.';
  if (code === 'auth/popup-closed-by-user') return 'Google sign-in was cancelled.';
  return getAuthErrorMessage(error, 'Something went wrong. Please try again.');
}

export default function AuthPage({ mode }: { mode: AuthMode }) {
  const {
    firebaseConfigured,
    firebaseUser,
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    sendPasswordReset,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isLogin = mode === 'login';
  const isRegister = mode === 'register';

  if (firebaseUser) return <Navigate to={from} replace />;

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      navigate(from, { replace: true });
    } catch (reason) {
      setError(friendly(reason));
    } finally {
      setBusy(false);
      setPassword('');
      setConfirmPassword('');
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (mode === 'reset-password') {
      if (busy) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      void sendPasswordReset(normalizedEmail)
        .then(() => setNotice('If an account exists for this email, Firebase will send a password reset link.'))
        .catch((reason: unknown) => setError(friendly(reason)))
        .finally(() => setBusy(false));
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }
    if (isRegister) {
      if (!name.trim()) {
        setError('Enter your full name.');
        return;
      }
      if (password.length < 6) {
        setError('Choose a password with at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      void run(() => registerWithEmail(name.trim(), normalizedEmail, password));
      return;
    }
    void run(() => signInWithEmail(normalizedEmail, password));
  };

  return (
    <div className="auth">
      <section className="panel auth__card">
        <h1>{isLogin ? 'Sign in to Minutes' : isRegister ? 'Create your account' : 'Reset your password'}</h1>
        {!firebaseConfigured && (
          <Notice tone="warning">
            Sign-in isn&apos;t set up yet. Add the <code>VITE_FIREBASE_*</code> values to your <code>.env</code> file.
          </Notice>
        )}
        {isLogin && (
          <>
            <button
              type="button"
              className="btn btn--navy btn--block auth__google"
              disabled={busy || !firebaseConfigured}
              onClick={() => void run(signInWithGoogle)}
            >
              <GoogleIcon width={18} height={18} />
              {busy ? 'Signing in…' : 'Continue with Google'}
            </button>
            <div className="auth__divider"><span>OR</span></div>
          </>
        )}
        <form className="form" onSubmit={submit} noValidate>
          {isRegister && (
            <div className="field">
              <label htmlFor="name">Full name</label>
              <input id="name" type="text" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          {mode !== 'reset-password' && (
            <>
              <div className="field">
                <label htmlFor="password">Password</label>
                <div className="auth__password">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={isLogin ? 'current-password' : 'new-password'}
                    required
                    minLength={isRegister ? 6 : undefined}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="auth__password-toggle"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              {isRegister && (
                <div className="field">
                  <label htmlFor="confirm-password">Confirm password</label>
                  <input
                    id="confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </div>
              )}
            </>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          {notice && <Notice tone="success">{notice}</Notice>}
          <button type="submit" className="btn btn--blue auth__submit" disabled={busy || !firebaseConfigured}>
            {busy
              ? mode === 'reset-password' ? 'Sending…' : isRegister ? 'Creating account…' : 'Signing in…'
              : mode === 'reset-password' ? 'Send reset link' : isRegister ? 'Create Account' : 'Sign In'}
          </button>
        </form>
        {isLogin ? (
          <div className="auth__links">
            <Link to="/forgot-password" state={{ from }}>Forgot password?</Link>
            <p className="auth__alt">Don&apos;t have an account? <Link to="/register" state={{ from }}>Create account</Link></p>
          </div>
        ) : isRegister ? (
          <p className="auth__alt">Already have an account? <Link to="/login" state={{ from }}>Sign in</Link></p>
        ) : (
          <p className="auth__alt"><Link to="/login" state={{ from }}>Back to Sign In</Link></p>
        )}
      </section>
    </div>
  );
}
