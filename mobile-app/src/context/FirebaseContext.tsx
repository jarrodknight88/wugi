// ─────────────────────────────────────────────────────────────────────
// Wugi — FirebaseContext
// Modular API for @react-native-firebase/auth v23
// ─────────────────────────────────────────────────────────────────────
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
} from '@react-native-firebase/auth';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';
import {
  upsertUserProfile,
  saveUserVibes,
  getUserProfile,
} from '../../firestoreService';

const auth = getAuth();

// ── Types ─────────────────────────────────────────────────────────────
type FirebaseContextValue = {
  user:           FirebaseAuthTypes.User | null;
  authLoading:    boolean;
  userVibes:      string[];
  saveVibes:      (vibes: string[]) => Promise<void>;
  signIn:         (email: string, password: string) => Promise<void>;
  signUp:         (email: string, password: string, displayName: string) => Promise<void>;
  signOut:        () => Promise<void>;
  authError:      string | null;
  clearAuthError: () => void;
};

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) throw new Error('useFirebase must be used inside FirebaseProvider');
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────
export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [user,        setUser]        = useState<FirebaseAuthTypes.User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [userVibes,   setUserVibes]   = useState<string[]>([]);
  const [authError,   setAuthError]   = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        try {
          await upsertUserProfile(
            firebaseUser.uid,
            firebaseUser.email || '',
            firebaseUser.displayName || ''
          );
          const profile = await getUserProfile(firebaseUser.uid);
          if (profile?.vibes && profile.vibes.length > 0) {
            setUserVibes(profile.vibes);
          }
        } catch (e) {
          console.log('FirebaseContext: failed to load profile', e);
        }
      } else {
        setUserVibes([]);
      }

      setAuthLoading(false);
    });

    return unsubscribe;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      setAuthError(null);
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e: any) {
      const msg = friendlyAuthError(e.code);
      setAuthError(msg);
      throw new Error(msg);
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    try {
      setAuthError(null);
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName });
      await upsertUserProfile(cred.user.uid, email, displayName);
    } catch (e: any) {
      const msg = friendlyAuthError(e.code);
      setAuthError(msg);
      throw new Error(msg);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await firebaseSignOut(auth);
      setUserVibes([]);
    } catch (e) {
      console.log('FirebaseContext: signOut error', e);
    }
  }, []);

  const saveVibes = useCallback(async (vibes: string[]) => {
    setUserVibes(vibes);
    if (!user) return;
    try {
      await saveUserVibes(user.uid, vibes);
    } catch (e) {
      console.log('FirebaseContext: saveVibes error', e);
    }
  }, [user]);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  return (
    <FirebaseContext.Provider value={{
      user, authLoading, userVibes, saveVibes,
      signIn, signUp, signOut,
      authError, clearAuthError,
    }}>
      {children}
    </FirebaseContext.Provider>
  );
}

// ── Friendly error messages ───────────────────────────────────────────
function friendlyAuthError(code: string): string {
  switch (code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
