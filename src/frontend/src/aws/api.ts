import { getFirebaseIdToken } from "../auth/firebase";
import { awsConfig } from "./awsConfig";

export async function awsRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getFirebaseIdToken();
  if (!token)
    throw new Error("Your Firebase session has expired. Please sign in again.");
  const base = awsConfig.apiUrl!.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/api/")
    ? path
    : `/api/v1${path.startsWith("/") ? path : `/${path}`}`;
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
        `CloudSentinels API request failed (${response.status}).`,
    );
  return body as T;
}
