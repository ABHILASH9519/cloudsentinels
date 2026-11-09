export const awsConfig = {
  region: import.meta.env.VITE_AWS_REGION as string | undefined,
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined,
  clientId: import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined,
  domain: (import.meta.env.VITE_COGNITO_DOMAIN as string | undefined)?.replace(
    /\/$/,
    "",
  ),
  apiUrl: (import.meta.env.VITE_AWS_API_URL as string | undefined)?.replace(
    /\/$/,
    "",
  ),
};

export function assertAwsConfig() {
  const missing = Object.entries(awsConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(
      `AWS authentication is not configured. Missing frontend settings: ${missing.join(", ")}.`,
    );
  }
}
