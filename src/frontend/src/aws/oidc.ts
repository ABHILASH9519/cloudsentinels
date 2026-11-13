import { assertAwsConfig, awsConfig } from "./awsConfig";

const TOKEN_KEY = "cloudsentinels.aws.tokens";
const VERIFIER_KEY = "cloudsentinels.aws.pkce";
const STATE_KEY = "cloudsentinels.aws.state";
const NONCE_KEY = "cloudsentinels.aws.nonce";

type TokenSet = {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_at: number;
};

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function randomString(size = 64) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return base64Url(bytes);
}
async function challenge(verifier: string) {
  return base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
}
function redirectUri() {
  return `${window.location.origin}/`;
}

export function getTokens(): TokenSet | null {
  try {
    return JSON.parse(
      sessionStorage.getItem(TOKEN_KEY) ?? "null",
    ) as TokenSet | null;
  } catch {
    return null;
  }
}
function saveTokens(
  tokens: Omit<TokenSet, "expires_at"> & { expires_in: number },
) {
  const next: TokenSet = {
    ...tokens,
    expires_at: Date.now() + tokens.expires_in * 1000,
  };
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(next));
}
export function clearTokens() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function startSignIn() {
  assertAwsConfig();
  const verifier = randomString(64);
  const state = randomString(32);
  const nonce = randomString(32);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(NONCE_KEY, nonce);
  const params = new URLSearchParams({
    client_id: awsConfig.clientId!,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: await challenge(verifier),
    state,
    nonce,
  });
  window.location.assign(
    `${awsConfig.domain}/oauth2/authorize?${params.toString()}`,
  );
}

export async function completeSignIn() {
  const url = new URL(window.location.href);
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    const description = url.searchParams.get("error_description");
    window.history.replaceState(
      {},
      document.title,
      window.location.pathname + window.location.hash,
    );
    throw new Error(description || `Cognito sign-in failed: ${oauthError}`);
  }
  const code = url.searchParams.get("code");
  if (!code) return;
  const state = url.searchParams.get("state");
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const expectedNonce = sessionStorage.getItem(NONCE_KEY);
  if (
    !state ||
    !expectedState ||
    state !== expectedState ||
    !verifier ||
    !expectedNonce
  ) {
    throw new Error(
      "Cognito sign-in state validation failed. Please sign in again.",
    );
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: awsConfig.clientId!,
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  const result = await fetch(`${awsConfig.domain}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!result.ok)
    throw new Error(
      "Cognito could not complete sign-in. Verify the app callback URL and Cognito configuration.",
    );
  const tokenSet = await result.json();
  const idPayload = (() => {
    try {
      const segment = String(tokenSet.id_token ?? "").split(".")[1];
      const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(
        atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4)),
      );
    } catch {
      return null;
    }
  })();
  if (
    !idPayload ||
    idPayload.nonce !== expectedNonce ||
    typeof tokenSet.access_token !== "string" ||
    typeof tokenSet.id_token !== "string" ||
    typeof tokenSet.expires_in !== "number" ||
    tokenSet.expires_in <= 0
  ) {
    throw new Error(
      "Cognito ID-token nonce validation failed. Please sign in again.",
    );
  }
  saveTokens(tokenSet);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(NONCE_KEY);
  window.history.replaceState(
    {},
    document.title,
    window.location.pathname + window.location.hash,
  );
}

export async function getIdToken(): Promise<string | null> {
  const accessToken = await getAccessToken();
  if (!accessToken) return null;
  return getTokens()?.id_token ?? null;
}

export async function getAccessToken(): Promise<string | null> {
  const tokens = getTokens();
  if (!tokens) return null;
  if (tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
  if (!tokens.refresh_token) {
    clearTokens();
    return null;
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: awsConfig.clientId!,
    refresh_token: tokens.refresh_token,
  });
  const result = await fetch(`${awsConfig.domain}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!result.ok) {
    clearTokens();
    return null;
  }
  const refreshed = await result.json();
  saveTokens({
    ...refreshed,
    refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
  });
  return refreshed.access_token;
}

export async function signOut() {
  assertAwsConfig();
  clearTokens();
  const params = new URLSearchParams({
    client_id: awsConfig.clientId!,
    logout_uri: redirectUri(),
  });
  window.location.assign(`${awsConfig.domain}/logout?${params.toString()}`);
}

export function decodeIdToken(): Record<string, unknown> | null {
  const token = getTokens()?.id_token;
  if (!token) return null;
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    const payload = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
