import { assertAwsConfig, awsConfig } from "./awsConfig";

const TOKEN_KEY = "cloudsentinels.aws.tokens";
const VERIFIER_KEY = "cloudsentinels.aws.pkce";
const STATE_KEY = "cloudsentinels.aws.state";

type TokenSet = { access_token: string; id_token: string; refresh_token?: string; expires_at: number };

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomString(size = 64) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return base64Url(bytes);
}
async function challenge(verifier: string) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}
function redirectUri() { return `${window.location.origin}/`; }

export function getTokens(): TokenSet | null {
  try { return JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? "null") as TokenSet | null; }
  catch { return null; }
}
function saveTokens(tokens: Omit<TokenSet, "expires_at"> & { expires_in: number }) {
  const next: TokenSet = { ...tokens, expires_at: Date.now() + tokens.expires_in * 1000 };
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(next));
}
export function clearTokens() { sessionStorage.removeItem(TOKEN_KEY); }

export async function startSignIn() {
  assertAwsConfig();
  const verifier = randomString(64);
  const state = randomString(32);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: awsConfig.clientId!,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: await challenge(verifier),
    state,
  });
  window.location.assign(`${awsConfig.domain}/oauth2/authorize?${params.toString()}`);
}

export async function completeSignIn() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return;
  const state = url.searchParams.get("state");
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!state || !expectedState || state !== expectedState || !verifier) {
    throw new Error("Cognito sign-in state validation failed. Please sign in again.");
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
  if (!result.ok) throw new Error("Cognito could not complete sign-in. Verify the app callback URL and Cognito configuration.");
  saveTokens(await result.json());
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
}

export async function getAccessToken(): Promise<string | null> {
  const tokens = getTokens();
  if (!tokens) return null;
  if (tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
  if (!tokens.refresh_token) { clearTokens(); return null; }
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
  if (!result.ok) { clearTokens(); return null; }
  const refreshed = await result.json();
  saveTokens({ ...refreshed, refresh_token: refreshed.refresh_token ?? tokens.refresh_token });
  return refreshed.access_token;
}

export async function signOut() {
  assertAwsConfig();
  clearTokens();
  const params = new URLSearchParams({ client_id: awsConfig.clientId!, logout_uri: redirectUri() });
  window.location.assign(`${awsConfig.domain}/logout?${params.toString()}`);
}

export function decodeIdToken(): Record<string, unknown> | null {
  const token = getTokens()?.id_token;
  if (!token) return null;
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch { return null; }
}
