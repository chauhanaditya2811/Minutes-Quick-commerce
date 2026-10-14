import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { firebaseAuth, firebaseConfigured } from '../firebase/firebase';
import { api, setTokenProvider } from '../services/api';
import { apiConfigured } from '../services/config';
import type { UpdateProfileInput, UserProfile } from '../types/user';

interface AuthContextValue {
  firebaseConfigured: boolean;
  firebaseUser: User | null;
  profile: UserProfile | null;
  profileError: string | null;
  /** True until Firebase reports the initial auth state. */
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (name: string, email: string, password: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  saveProfile: (input: UpdateProfileInput) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(firebaseConfigured);

  // Give the API layer a fresh ID token for every protected request.
  useEffect(() => {
    setTokenProvider(async () => (firebaseAuth?.currentUser ? firebaseAuth.currentUser.getIdToken() : null));
  }, []);

  const refreshProfile = useCallback(async () => {
    const currentUser = firebaseAuth?.currentUser;
    if (!apiConfigured || !currentUser) return;
    try {
      const nextProfile = await api.getMe();
      if (firebaseAuth?.currentUser?.uid !== currentUser.uid) return;
      setProfile(nextProfile);
      setProfileError(null);
    } catch (e) {
      if (firebaseAuth?.currentUser?.uid !== currentUser.uid) return;
      setProfile(null);
      setProfileError(e instanceof Error ? e.message : 'Could not load your profile.');
    }
  }, []);

  useEffect(() => {
    if (!firebaseAuth) {
      // No Firebase configured – nothing to wait for.
      setLoading(false);
      return;
    }
    return onAuthStateChanged(firebaseAuth, (u) => {
      setFirebaseUser(u);
      setLoading(false);
      setProfile(null);
      setProfileError(null);
      if (u) void refreshProfile();
    });
  }, [refreshProfile]);

  const requireAuth = () => {
    if (!firebaseAuth) throw new Error('Firebase is not configured. Add the VITE_FIREBASE_* values to your .env file.');
    return firebaseAuth;
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      firebaseConfigured,
      firebaseUser,
      profile,
      profileError,
      loading,
      signInWithGoogle: async () => {
        await signInWithPopup(requireAuth(), new GoogleAuthProvider());
      },
      signInWithEmail: async (email, password) => {
        await signInWithEmailAndPassword(requireAuth(), email, password);
      },
      registerWithEmail: async (name, email, password) => {
        const userCredential = await createUserWithEmailAndPassword(requireAuth(), email, password);
        await updateProfile(userCredential.user, { displayName: name });
        await userCredential.user.getIdToken(true);
      },
      sendPasswordReset: async (email) => {
        await sendPasswordResetEmail(requireAuth(), email);
      },
      signOut: async () => {
        if (firebaseAuth) await fbSignOut(firebaseAuth);
      },
      refreshProfile,
      saveProfile: async (input) => {
        const nextProfile = await api.updateMe(input);
        setProfile(nextProfile);
        setProfileError(null);
      },
    }),
    [firebaseUser, profile, profileError, loading, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
