import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { GoogleIcon } from '../../components/ui/Icons';
import Notice from '../../components/ui/Notice';

function friendly(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found'))
    return 'Email or password is incorrect.';
  if (code.includes('email-already-in-use')) return 'An account with this email already exists. Try logging in.';
  if (code.includes('weak-password')) return 'Choose a password with at least 6 characters.';
  if (code.includes('popup-closed')) return 'Sign-in was cancelled.';
  return e instanceof Error ? e.message : 'Something went wrong. Try again.';
}

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { firebaseConfigured, firebaseUser, signInWithGoogle, signInWithEmail, registerWithEmail } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLogin = mode === 'login';

  if (firebaseUser) return <Navigate to={from} replace />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      navigate(from, { replace: true });
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => (isLogin ? signInWithEmail(email, password) : registerWithEmail(email, password)));
  };

  return (
    <div className="auth">
      <section className="panel auth__card">
        <h1>{isLogin ? 'Please Login' : 'Create your account'}</h1>
        {!firebaseConfigured && (
          <Notice tone="warning">
            Sign-in isn't set up yet. Add the <code>VITE_FIREBASE_*</code> values to your <code>.env</code> file.
          </Notice>
        )}
        <form className="form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete={isLogin ? 'current-password' : 'new-password'} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <button type="submit" className="btn btn--blue" disabled={busy || !firebaseConfigured}>
            {isLogin ? 'Login' : 'Register'}
          </button>
        </form>
        <p className="auth__alt">
          {isLogin ? <>Haven't an account? Please <Link to="/register" state={{ from }}>Register</Link></> : <>Already registered? <Link to="/login" state={{ from }}>Login</Link></>}
        </p>
        <button type="button" className="btn btn--navy btn--block" disabled={busy || !firebaseConfigured} onClick={() => void run(signInWithGoogle)}>
          <GoogleIcon width={18} height={18} /> Sign in with Google
        </button>
      </section>
    </div>
  );
}
