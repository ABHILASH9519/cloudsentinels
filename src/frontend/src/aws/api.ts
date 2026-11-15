import { getFirebaseIdToken } from "../auth/firebase";
import { awsConfig } from "./awsConfig";

function normalizeAwsApiPath(path: string) {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("An AWS API route is required.");
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withLeadingSlash === "/api/v1") return "/";
  if (withLeadingSlash.startsWith("/api/v1/")) {
    return withLeadingSlash.slice("/api/v1".length);
  }
  return withLeadingSlash;
}

export async function awsRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getFirebaseIdToken();
  if (!token)
    throw new Error("Your Firebase session has expired. Please sign in again.");
  const base = awsConfig.apiUrl;
  if (!base)
    throw new Error("AWS API is not configured. Set VITE_AWS_API_URL.");
  const normalizedPath = normalizeAwsApiPath(path);
  const response = await fetch(`${base}${normalizedPath}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      body.message ??
        body.error ??
        `CloudSentinels AWS API request failed (${response.status}).`,
    );
  return body as T;
}
