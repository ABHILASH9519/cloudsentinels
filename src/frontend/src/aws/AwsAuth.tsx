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
import { assertAwsConfig } from "./awsConfig";
import {
  completeSignIn,
  decodeIdToken,
  getAccessToken,
  signOut,
  startSignIn,
} from "./oidc";

type AuthContextValue = {
  isLoaded: boolean;
  isSignedIn: boolean;
  user: { id: string; email: string | null; name: string | null } | null;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  getToken: () => Promise<string | null>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AwsAuthProvider({ children }: PropsWithChildren) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<AuthContextValue["user"]>(null);

  const refresh = useCallback(async () => {
    const token = await getAccessToken();
    const claims = decodeIdToken();
    setUser(
      token && claims && typeof claims.sub === "string"
        ? {
            id: claims.sub,
            email: typeof claims.email === "string" ? claims.email : null,
            name: typeof claims.name === "string" ? claims.name : null,
          }
        : null,
    );
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV && import.meta.env.VITE_CLOUDSENTINELS_LOCAL_DEMO === "true") {
      setUser({ id: "local-demo", email: "demo@localhost", name: "Local Demo" });
      setIsLoaded(true);
      return;
    }
    let active = true;
    void (async () => {
      try {
        assertAwsConfig();
        await completeSignIn();
        await refresh();
      } catch (reason) {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "AWS authentication initialization failed.",
          );
      } finally {
        if (active) setIsLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [refresh]);

  const signIn = useCallback(async () => {
    try {
      setError(null);
      await startSignIn();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not start sign-in.",
      );
    }
  }, []);
  const logout = useCallback(async () => {
    await signOut();
  }, []);
  const getToken = useCallback(() => getAccessToken(), []);
  const value = useMemo(
    () => ({
      isLoaded,
      isSignedIn: !!user,
      user,
      error,
      signIn,
      signOut: logout,
      getToken,
    }),
    [isLoaded, user, error, signIn, logout, getToken],
  );

  return createElement(AuthContext.Provider, { value, children });
}

export function useAwsAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AwsAuthProvider is missing.");
  return value;
}
