import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { previewMode } from '../services/config';
import Loading from '../components/Loading';

/** UX guard only. The backend verifies the Firebase token on every protected request. */
export default function PrivateRoute({ children }: { children: ReactNode }) {
  const { firebaseUser, loading } = useAuth();
  const location = useLocation();

  if (previewMode) return <>{children}</>; // lets you inspect screens before a backend exists
  if (loading) return <Loading />;
  if (!firebaseUser) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
