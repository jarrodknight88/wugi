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
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithCredential,
  AppleAuthProvider,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  updateProfile,
  sendEmailVerification,
} from '@react-native-firebase/auth';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';
import {
  upsertUserProfile,
  saveUserVibes,
  getUserProfile,
  markEmailVerified,
} from '../../firestoreService';

const auth = getAuth();

// ── Types ─────────────────────────────────────────────────────────────
export type SocialSignInResult = { isNewUser: boolean };

type FirebaseContextValue = {
  user:                     FirebaseAuthTypes.User | null;
  authLoading:              boolean;
  userVibes:                string[];
  saveVibes:                (vibes: string[]) => Promise<void>;
  signIn:                   (email: string, password: string) => Promise<void>;
  signUp:                   (email: string, password: string, displayName: string) => Promise<void>;
  // Social sign-in. Resolves with isNewUser so the caller can route new
  // accounts to username selection. Rejects with a friendly Error on
  // failure; resolves never on user-cancel (throws { cancelled: true }).
  signInWithApple:          () => Promise<SocialSignInResult>;
  signInWithGoogle:         () => Promise<SocialSignInResult>;
  appleAuthAvailable:       boolean;
  googleAuthAvailable:      boolean;
  signOut:                  () => Promise<void>;
  authError:                string | null;
  clearAuthError:           () => void;
  resendVerificationEmail:  () => Promise<void>;
  refreshEmailVerified:     () => Promise<boolean>;
};

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

// Web client ID for Google Sign-In (Firebase console → Authentication →
// Sign-in method → Google → Web SDK configuration). Required for the
// idToken exchange. When unset, the Google button hides itself.
const GOOGLE_WEB_CLIENT_ID: string =
  (Constants.expoConfig?.extra as any)?.googleWebClientId ?? '';

// Thrown when the user dismisses a social sign-in sheet — callers should
// swallow this silently rather than show an error banner.
export class AuthCancelledError extends Error {
  cancelled = true as const;
  constructor() { super('cancelled'); }
}

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
  const [appleAuthAvailable,  setAppleAuthAvailable]  = useState(false);
  const [googleAuthAvailable, setGoogleAuthAvailable] = useState(false);

  // Probe social sign-in availability once. Dynamic imports so a build
  // without the native modules degrades to email auth instead of crashing.
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (Platform.OS === 'ios') {
        try {
          const Apple = await import('expo-apple-authentication');
          const ok = await Apple.isAvailableAsync();
          if (mounted) setAppleAuthAvailable(ok);
        } catch { /* module not in this build — keep hidden */ }
      }
      if (GOOGLE_WEB_CLIENT_ID) {
        try {
          const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
          GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
          if (mounted) setGoogleAuthAvailable(true);
        } catch { /* module not in this build — keep hidden */ }
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        try {
          await upsertUserProfile(
            firebaseUser.uid,
            firebaseUser.email || '',
            firebaseUser.displayName || '',
            firebaseUser.emailVerified
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
      // Reload user to ensure the auth token is fully settled before Firestore write
      await cred.user.reload();
      // Small delay to let the auth token propagate to Firestore security rules
      await new Promise(resolve => setTimeout(resolve, 300));
      await upsertUserProfile(cred.user.uid, email, displayName, false);
      // Fire-and-forget verification email — failure must not block signup
      try { await sendEmailVerification(cred.user); }
      catch (e) { console.log('FirebaseContext: sendEmailVerification error', e); }
    } catch (e: any) {
      const msg = friendlyAuthError(e.code);
      setAuthError(msg);
      throw new Error(msg);
    }
  }, []);

  // ── Sign in with Apple ─────────────────────────────────────────────
  // expo-apple-authentication + nonce → Firebase credential. Apple only
  // returns fullName on the FIRST authorization, so persist it then.
  const signInWithApple = useCallback(async (): Promise<SocialSignInResult> => {
    setAuthError(null);
    try {
      const Apple  = await import('expo-apple-authentication');
      const Crypto = await import('expo-crypto');

      const rawNonce = Array.from({ length: 32 }, () =>
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]
      ).join('');
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256, rawNonce
      );

      const appleCred = await Apple.signInAsync({
        requestedScopes: [
          Apple.AppleAuthenticationScope.FULL_NAME,
          Apple.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      if (!appleCred.identityToken) throw new Error('No identity token');

      const credential = AppleAuthProvider.credential(appleCred.identityToken, rawNonce);
      const result     = await signInWithCredential(auth, credential);
      const isNewUser  = result.additionalUserInfo?.isNewUser === true;

      // First-authorization name capture (Apple never sends it again)
      const fullName = [appleCred.fullName?.givenName, appleCred.fullName?.familyName]
        .filter(Boolean).join(' ');
      if (fullName && !result.user.displayName) {
        try {
          await updateProfile(result.user, { displayName: fullName });
          await upsertUserProfile(result.user.uid, result.user.email || '', fullName, true);
        } catch { /* non-blocking */ }
      }
      return { isNewUser };
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED' || e?.code === 'ERR_CANCELED') {
        throw new AuthCancelledError();
      }
      const msg = e?.code ? friendlyAuthError(e.code) : 'Apple sign-in failed. Please try again.';
      setAuthError(msg);
      throw new Error(msg);
    }
  }, []);

  // ── Sign in with Google ────────────────────────────────────────────
  const signInWithGoogle = useCallback(async (): Promise<SocialSignInResult> => {
    setAuthError(null);
    try {
      const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      const idToken  = (response as any)?.data?.idToken ?? (response as any)?.idToken;
      if (!idToken) throw new AuthCancelledError(); // dismissed sheet returns no token

      const credential = GoogleAuthProvider.credential(idToken);
      const result     = await signInWithCredential(auth, credential);
      return { isNewUser: result.additionalUserInfo?.isNewUser === true };
    } catch (e: any) {
      if (e instanceof AuthCancelledError) throw e;
      if (e?.code === 'SIGN_IN_CANCELLED' || e?.code === '12501') {
        throw new AuthCancelledError();
      }
      const msg = e?.code ? friendlyAuthError(e.code) : 'Google sign-in failed. Please try again.';
      setAuthError(msg);
      throw new Error(msg);
    }
  }, []);

  const resendVerificationEmail = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) throw new Error('Not signed in');
    await sendEmailVerification(current);
  }, []);

  const refreshEmailVerified = useCallback(async (): Promise<boolean> => {
    const current = auth.currentUser;
    if (!current) return false;
    await current.reload();
    const refreshed = auth.currentUser;
    const verified  = !!refreshed?.emailVerified;
    if (verified && refreshed) {
      try { await markEmailVerified(refreshed.uid); }
      catch (e) { console.log('FirebaseContext: markEmailVerified error', e); }
      // reload() does not re-fire onAuthStateChanged — push the latest user
      // into local state so consumers (the banner) re-render.
      setUser(refreshed);
    }
    return verified;
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
      signInWithApple, signInWithGoogle,
      appleAuthAvailable, googleAuthAvailable,
      authError, clearAuthError,
      resendVerificationEmail, refreshEmailVerified,
    }}>
      {children}
    </FirebaseContext.Provider>
  );
}

// ── Friendly error messages ───────────────────────────────────────────
export function friendlyAuthError(code: string): string {
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
