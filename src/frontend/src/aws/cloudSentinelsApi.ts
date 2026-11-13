import { awsConfig } from "./awsConfig";
import { getIdToken } from "./oidc";

export async function cloudSentinelsRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const base = awsConfig.cloudSentinelsApiUrl;
  if (!base) {
    throw new Error(
      "CloudSentinels Go API is not configured. Set VITE_CLOUDSENTINELS_API_URL to the Go API HTTPS URL.",
    );
  }
  const token = await getIdToken();
  if (!token) throw new Error("Your Cognito session expired. Sign in again.");
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      body.message ?? body.error ?? `CloudSentinels API request failed (${response.status}).`,
    );
  }
  return body as T;
}
