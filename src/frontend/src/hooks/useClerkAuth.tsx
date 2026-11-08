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

type ClerkUser = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  primaryEmailAddress?: { emailAddress: string } | null;
  imageUrl?: string;
};

type ClerkSession = {
  getToken: (options?: { template?: string }) => Promise<string | null>;
};

type ClerkInstance = {
  loaded: boolean;
  isSignedIn: boolean;
  user: ClerkUser | null | undefined;
  session: ClerkSession | null | undefined;
  load: (options?: Record<string, unknown>) => Promise<void>;
  addListener: (
    listener: (state: {
      user?: ClerkUser | null;
      session?: ClerkSession | null;
    }) => void,
  ) => () => void;
  mountSignIn: (
    node: HTMLDivElement,
    props?: Record<string, unknown>,
  ) => void;
  unmountSignIn: (node: HTMLDivElement) => void;
  signOut: () => Promise<void>;
};

declare global {
  interface Window {
    Clerk?: new (publishableKey: string) => ClerkInstance;
    __internal_ClerkUICtor?: unknown;
  }
}

type ClerkAuthValue = {
  clerk: ClerkInstance | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  user: ClerkUser | null;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
  error: string | null;
};

const ClerkAuthContext = createContext<ClerkAuthValue | null>(null);
let clerkInitialization: Promise<ClerkInstance> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`,
    );
    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }

    const script = existing ?? document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () =>
      reject(new Error("Clerk authentication scripts could not be loaded."));
    if (!existing) document.head.appendChild(script);
  });
}

async function initializeClerk(): Promise<ClerkInstance> {
  if (clerkInitialization) return clerkInitialization;

  clerkInitialization = (async () => {
    const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
    if (!publishableKey || !publishableKey.startsWith("pk_")) {
      throw new Error(
        "Set VITE_CLERK_PUBLISHABLE_KEY in the frontend environment.",
      );
    }

    let frontendApi: string;
    try {
      frontendApi = atob(publishableKey.split("_")[2]).replace(/\$$/, "");
    } catch {
      throw new Error("The configured Clerk publishable key is invalid.");
    }
    if (!frontendApi || !/^[a-zA-Z0-9.-]+$/.test(frontendApi)) {
      throw new Error("The configured Clerk Frontend API domain is invalid.");
    }

    await loadScript(
      `https://${frontendApi}/npm/@clerk/ui@1/dist/ui.browser.js`,
    );
    await loadScript(
      `https://${frontendApi}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`,
    );
    if (!window.Clerk) {
      throw new Error("ClerkJS loaded without exposing its browser SDK.");
    }

    const clerk = new window.Clerk(publishableKey);
    await clerk.load({
      ui: { ClerkUI: window.__internal_ClerkUICtor },
    });
    return clerk;
  })().catch((error: unknown) => {
    clerkInitialization = null;
    throw error;
  });

  return clerkInitialization;
}

export function ClerkAuthProvider({ children }: PropsWithChildren) {
  const [clerk, setClerk] = useState<ClerkInstance | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [user, setUser] = useState<ClerkUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    void initializeClerk()
      .then((instance) => {
        if (!active) return;
        setClerk(instance);

        const sync = (state?: {
          user?: ClerkUser | null;
          session?: ClerkSession | null;
        }) => {
          const nextUser =
            state?.user === undefined ? instance.user : state.user;
          const nextSession =
            state?.session === undefined ? instance.session : state.session;
          setUser(nextUser ?? null);
          setIsSignedIn(Boolean(nextUser && nextSession));
          setIsLoaded(true);
        };

        unsubscribe = instance.addListener(sync);
        sync();
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Clerk initialization failed.",
          );
          setIsLoaded(true);
        }
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const getToken = useCallback(async () => {
    if (!clerk?.session) return null;
    return clerk.session.getToken();
  }, [clerk]);

  const signOut = useCallback(async () => {
    if (clerk) await clerk.signOut();
  }, [clerk]);

  const value = useMemo(
    () => ({
      clerk,
      isLoaded,
      isSignedIn,
      user,
      getToken,
      signOut,
      error,
    }),
    [clerk, isLoaded, isSignedIn, user, getToken, signOut, error],
  );

  return createElement(ClerkAuthContext.Provider, { value, children });
}

export function useClerkAuth(): ClerkAuthValue {
  const context = useContext(ClerkAuthContext);
  if (!context) {
    throw new Error("ClerkAuthProvider is missing from the component tree.");
  }
  return context;
}
