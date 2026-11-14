import { getApps, initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  type User,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import {
  type PropsWithChildren,
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};
const missingConfig = Object.entries(firebaseConfig)
  .filter(([, value]) => !value?.trim())
  .map(([key]) => key);
const firebaseApp =
  missingConfig.length === 0
    ? (getApps()[0] ?? initializeApp(firebaseConfig))
    : null;
export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null;

type AuthUser = { id: string; email: string | null; name: string | null };
type AuthContextValue = {
  isLoaded: boolean;
  isSignedIn: boolean;
  user: AuthUser | null;
  error: string | null;
  signIn: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  getToken: () => Promise<string | null>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

function mapUser(user: User | null): AuthUser | null {
  return user
    ? { id: user.uid, email: user.email, name: user.displayName }
    : null;
}

export function FirebaseAuthProvider({ children }: PropsWithChildren) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(
    missingConfig.length
      ? `Firebase Authentication is not configured. Missing: ${missingConfig.join(", ")}.`
      : null,
  );
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (!firebaseAuth) {
      setIsLoaded(true);
      return;
    }
    return onAuthStateChanged(
      firebaseAuth,
      (nextUser) => {
        setUser(mapUser(nextUser));
        setIsLoaded(true);
      },
      (reason) => {
        setError(reason.message);
        setIsLoaded(true);
      },
    );
  }, []);

  const signIn = useCallback(async () => {
    if (!firebaseAuth) {
      setError("Firebase client configuration is missing.");
      return;
    }
    setError(null);
    try {
      await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Google sign-in failed.",
      );
    }
  }, []);

  const signInEmail = useCallback(async (email: string, password: string) => {
    if (!firebaseAuth)
      throw new Error("Firebase client configuration is missing.");
    setError(null);
    await signInWithEmailAndPassword(firebaseAuth, email, password);
  }, []);

  const signUpEmail = useCallback(async (email: string, password: string) => {
    if (!firebaseAuth)
      throw new Error("Firebase client configuration is missing.");
    setError(null);
    await createUserWithEmailAndPassword(firebaseAuth, email, password);
  }, []);

  const logout = useCallback(async () => {
    if (firebaseAuth) await firebaseSignOut(firebaseAuth);
  }, []);

  const getToken = useCallback(async () => {
    if (!firebaseAuth?.currentUser) return null;
    return firebaseAuth.currentUser.getIdToken();
  }, []);

  const value = useMemo(
    () => ({
      isLoaded,
      isSignedIn: !!user,
      user,
      error,
      signIn,
      signInEmail,
      signUpEmail,
      signOut: logout,
      getToken,
    }),
    [isLoaded, user, error, signIn, signInEmail, signUpEmail, logout, getToken],
  );
  return createElement(AuthContext.Provider, { value, children });
}

export function useFirebaseAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("FirebaseAuthProvider is missing.");
  return value;
}
