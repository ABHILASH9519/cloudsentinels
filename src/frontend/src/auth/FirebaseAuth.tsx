import { getApps, initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  type User,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  getAuth,
  getIdTokenResult,
  getRedirectResult,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
} from "firebase/auth";
import {
  type PropsWithChildren,
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { localOperatorMode, localOperatorToken, setLocalOperatorToken } from "./localOperator";

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

type AuthUser = { id: string; email: string | null; name: string | null; roles: string[] };
type AuthContextValue = {
  isLoaded: boolean;
  isConfigured: boolean;
  isSignedIn: boolean;
  user: AuthUser | null;
  roles: string[];
  isOperator: boolean;
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
    ? { id: user.uid, email: user.email, name: user.displayName, roles: [] }
    : null;
}

function LocalOperatorProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  async function login() {
    try {
      const response = await fetch("http://127.0.0.1:8082/api/v1/auth/me", {
        headers: { Authorization: `Bearer ${input}` },
      });
      if (!response.ok) throw new Error("The API rejected this operator token.");
      const principal = await response.json();
      setLocalOperatorToken(input);
      setInput("");
      setError("");
      setUser({ id: principal.uid, name: "Local operator", email: null, roles: principal.roles });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The local API is unavailable.");
    }
  }
  if (!user) return (
    <main className="mx-auto mt-24 max-w-sm space-y-4 p-4">
      <h1 className="text-2xl font-bold">CloudSentinels</h1>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void login(); }}>
        <label>Local operator token<input className="block w-full rounded border bg-background p-2"
          type="password" autoComplete="off" required value={input} onChange={(e) => setInput(e.target.value)} /></label>
        <p className="text-sm">Use OPERATOR_KEY from your private .env.floci file.</p>
        <button className="rounded bg-primary px-4 py-2 text-primary-foreground" type="submit">Connect</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
  const unavailable = async () => { throw new Error("Use local operator sign-in."); };
  return <AuthContext.Provider value={{
    isLoaded: true, isConfigured: true, isSignedIn: true, user, roles: user.roles,
    isOperator: user.roles.includes("operator"), error: null,
    signIn: unavailable, signInEmail: unavailable, signUpEmail: unavailable,
    signOut: async () => { setLocalOperatorToken(null); window.location.reload(); },
    getToken: async () => localOperatorToken(),
  }}>{children}</AuthContext.Provider>;
}

export function FirebaseAuthProvider({ children }: PropsWithChildren) {
  return localOperatorMode ? <LocalOperatorProvider>{children}</LocalOperatorProvider> :
    <FirebaseProvider>{children}</FirebaseProvider>;
}

function FirebaseProvider({ children }: PropsWithChildren) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(
    missingConfig.length
      ? `Firebase Authentication is not configured. Missing: ${missingConfig.join(", ")}.`
      : null,
  );
  const [user, setUser] = useState<AuthUser | null>(null);
  const roleLookupVersion = useRef(0);

  useEffect(() => {
    if (!firebaseAuth) {
      setIsLoaded(true);
      return;
    }
    // Complete redirect-based Google sign-in when the browser blocks popups.
    // The auth-state listener below remains the single source of signed-in state.
    void getRedirectResult(firebaseAuth).catch((reason: unknown) => {
      setError(
        reason instanceof Error ? reason.message : "Google redirect sign-in failed.",
      );
    });
    return onIdTokenChanged(
      firebaseAuth,
      (nextUser) => {
        const lookupVersion = ++roleLookupVersion.current;
        const mappedUser = mapUser(nextUser);
        setUser((previousUser) =>
          mappedUser
            ? {
                ...mappedUser,
                roles:
                  previousUser?.id === mappedUser.id
                    ? previousUser.roles
                    : [],
              }
            : null,
        );
        setIsLoaded(true);
        if (nextUser) {
          void getIdTokenResult(nextUser)
            .then((tokenResult) => {
              const rawRoles = tokenResult.claims.roles;
              const roles = Array.isArray(rawRoles)
                ? rawRoles.filter((role): role is string => typeof role === "string")
                : [];
              if (
                lookupVersion === roleLookupVersion.current &&
                firebaseAuth?.currentUser?.uid === nextUser.uid
              ) {
                setUser({
                  id: nextUser.uid,
                  email: nextUser.email,
                  name: nextUser.displayName,
                  roles,
                });
              }
            })
            .catch(() => {
              if (
                lookupVersion === roleLookupVersion.current &&
                firebaseAuth?.currentUser?.uid === nextUser.uid
              ) {
                setUser((previousUser) =>
                  previousUser?.id === nextUser.uid
                    ? { ...previousUser, roles: [] }
                    : previousUser,
                );
              }
            });
        }
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
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await signInWithPopup(firebaseAuth, provider);
    } catch (reason) {
      const code =
        typeof reason === "object" && reason !== null && "code" in reason
          ? String((reason as { code: unknown }).code)
          : "";
      if (code === "auth/popup-blocked") {
        try {
          // Redirect authentication does not require a browser popup.
          await signInWithRedirect(firebaseAuth, provider);
          return;
        } catch (redirectReason) {
          setError(
            redirectReason instanceof Error
              ? redirectReason.message
              : "Google redirect sign-in failed.",
          );
          return;
        }
      }
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

  const roles = user?.roles ?? [];
  const isOperator = roles.some((role) =>
    ["operator", "admin"].includes(role.toLowerCase()),
  );
  const value = useMemo(
    () => ({
      isLoaded,
      isConfigured: !!firebaseAuth,
      isSignedIn: !!user,
      user,
      roles,
      isOperator,
      error,
      signIn,
      signInEmail,
      signUpEmail,
      signOut: logout,
      getToken,
    }),
    [isLoaded, user, roles, isOperator, error, signIn, signInEmail, signUpEmail, logout, getToken],
  );
  return createElement(AuthContext.Provider, { value, children });
}

export function useFirebaseAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("FirebaseAuthProvider is missing.");
  return value;
}
