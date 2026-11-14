function normalizeBaseUrl(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed?.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

const apiUrl = normalizeBaseUrl(import.meta.env.VITE_CLOUDSENTINELS_API_URL as string | undefined);
const rawConfig = { apiUrl, cloudSentinelsApiUrl: apiUrl };
export const awsConfig = rawConfig;

export function getAwsConfigError(): string | null {
  if (!rawConfig.apiUrl) return "VITE_CLOUDSENTINELS_API_URL must point to the CloudSentinels Go API.";
  try {
    const parsed = new URL(rawConfig.apiUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      return "VITE_CLOUDSENTINELS_API_URL must use HTTPS outside local development.";
    }
  } catch {
    return "VITE_CLOUDSENTINELS_API_URL must be a valid URL.";
  }
  return null;
}

export function assertAwsConfig() {
  const error = getAwsConfigError();
  if (error) throw new Error(error);
}
