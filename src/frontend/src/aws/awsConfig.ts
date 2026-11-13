function normalizeBaseUrl(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed?.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

const rawConfig = {
  region: import.meta.env.VITE_AWS_REGION as string | undefined,
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined,
  clientId: import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined,
  domain: normalizeBaseUrl(import.meta.env.VITE_COGNITO_DOMAIN as string | undefined),
  apiUrl: normalizeBaseUrl(import.meta.env.VITE_AWS_API_URL as string | undefined),
  cloudSentinelsApiUrl: normalizeBaseUrl(import.meta.env.VITE_CLOUDSENTINELS_API_URL as string | undefined),
};

export const awsConfig = rawConfig;

const requiredSettings: Array<[keyof typeof rawConfig, string]> = [
  ["region", "VITE_AWS_REGION"],
  ["userPoolId", "VITE_COGNITO_USER_POOL_ID"],
  ["clientId", "VITE_COGNITO_CLIENT_ID"],
  ["domain", "VITE_COGNITO_DOMAIN"],
  ["apiUrl", "VITE_AWS_API_URL"],
];

export function getAwsConfigError(): string | null {
  const missing = requiredSettings
    .filter(([key]) => !rawConfig[key]?.trim())
    .map(([, envName]) => envName);

  if (missing.length) {
    return [
      "AWS Cognito is not configured for this deployment.",
      `Missing Vercel environment variables: ${missing.join(", ")}.`,
      "Deploy the AWS foundation/runtime, copy the outputs into Vercel, then create a new deployment.",
    ].join(" ");
  }

  if (!/^[a-z0-9-]+$/.test(rawConfig.region ?? "")) {
    return "VITE_AWS_REGION must be a valid AWS region such as ap-south-1.";
  }
  if (!/^[a-z0-9-]+_[A-Za-z0-9]+$/.test(rawConfig.userPoolId ?? "")) {
    return "VITE_COGNITO_USER_POOL_ID must be the UserPoolId output from the cloudsentinels-core stack.";
  }
  if (!/^[A-Za-z0-9]+$/.test(rawConfig.clientId ?? "")) {
    return "VITE_COGNITO_CLIENT_ID must be the UserPoolClientId output from the cloudsentinels-core stack.";
  }

  for (const [key, envName] of [["domain", "VITE_COGNITO_DOMAIN"], ["apiUrl", "VITE_AWS_API_URL"]] as const) {
    try {
      const parsed = new URL(rawConfig[key] ?? "");
      if (parsed.protocol !== "https:") throw new Error("https required");
    } catch {
      return `${envName} must be a valid HTTPS URL copied from the AWS stack outputs.`;
    }
  }

  return null;
}

export function assertAwsConfig() {
  const error = getAwsConfigError();
  if (error) throw new Error(error);
}
