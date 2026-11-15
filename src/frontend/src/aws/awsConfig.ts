function normalizeBaseUrl(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed?.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

const apiUrl = normalizeBaseUrl(import.meta.env.VITE_AWS_API_URL as string | undefined);
const cloudSentinelsApiUrl = normalizeBaseUrl(
  import.meta.env.VITE_CLOUDSENTINELS_API_URL as string | undefined,
);

export const awsConfig = { apiUrl, cloudSentinelsApiUrl };

function validateBaseUrl(value: string | undefined, variableName: string) {
  if (!value) return `${variableName} must be configured.`;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" &&
      parsed.hostname !== "localhost" &&
      parsed.hostname !== "127.0.0.1"
    ) {
      return `${variableName} must use HTTPS outside local development.`;
    }
  } catch {
    return `${variableName} must be a valid absolute URL.`;
  }
  return null;
}

export function getAwsConfigError(): string | null {
  return validateBaseUrl(apiUrl, "VITE_AWS_API_URL");
}

export function getCloudSentinelsConfigError(): string | null {
  return validateBaseUrl(
    cloudSentinelsApiUrl,
    "VITE_CLOUDSENTINELS_API_URL",
  );
}

export function assertAwsConfig() {
  const error = getAwsConfigError();
  if (error) throw new Error(error);
}
