import { awsConfig } from "./awsConfig";
import { getAccessToken } from "./oidc";

export async function awsRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("Your session has expired. Please sign in again.");
  const response = await fetch(`${awsConfig.apiUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `AWS API request failed (${response.status}).`);
  return body as T;
}
