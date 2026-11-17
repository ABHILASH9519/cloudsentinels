import { getFirebaseIdToken } from "../auth/firebase";

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

const configuredBaseUrl = normalizeBaseUrl(
  import.meta.env.VITE_CLOUDSENTINELS_API_URL as string | undefined,
);

/** Returns a human-readable configuration error, or null when valid. */
export function getCloudSentinelsConfigError(): string | null {
  if (!configuredBaseUrl) {
    return "VITE_CLOUDSENTINELS_API_URL must be configured.";
  }
  try {
    const parsed = new URL(configuredBaseUrl);
    const localHost =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !localHost) {
      return "VITE_CLOUDSENTINELS_API_URL must use HTTPS outside local development.";
    }
  } catch {
    return "VITE_CLOUDSENTINELS_API_URL must be a valid absolute URL.";
  }
  return null;
}

/**
 * Calls the CloudSentinels Go API with the current Firebase ID token.
 * Paths are absolute (for example "/api/v1/incidents").
 */
export async function cloudSentinelsRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const base = configuredBaseUrl;
  if (!base) {
    throw new Error(
      "CloudSentinels Go API is not configured. Set VITE_CLOUDSENTINELS_API_URL.",
    );
  }
  const token = await getFirebaseIdToken();
  if (!token) throw new Error("Your Firebase session expired. Sign in again.");
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      body.message ??
        body.error ??
        `CloudSentinels API request failed (${response.status}).`,
    );
  }
  return body as T;
}
