# CloudSentinels Firebase Authentication

Firebase Authentication is the only interactive user identity provider for the React application. The browser obtains a Firebase ID token; the Go API verifies that token with the Firebase Admin SDK before serving protected API routes.

## Firebase project setup

1. Create or select the Firebase project in the Firebase console.
2. In **Authentication â†’ Sign-in method**, enable Google and Email/Password providers.
3. In **Project settings â†’ General â†’ Your apps**, register the CloudSentinels web app.
4. Add the local and production hostnames to **Authentication â†’ Settings â†’ Authorized domains**.
5. Copy the Web App configuration values into the frontend environment:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_APP_ID`

The web API key and app identifiers are public Firebase client configuration, not service-account credentials. Do not place service-account JSON or private keys in any `VITE_*` variable.

## Go API verification

Set `FIREBASE_PROJECT_ID` on the Go API to the same project ID. The Firebase Admin SDK verifies signature, issuer, audience, subject and token expiry. For local development, set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account JSON file outside the repository, or use Google Application Default Credentials.

For AWS production, prefer a dedicated service account credential delivered through AWS Secrets Manager / a secure runtime-mounted file, or a properly configured Google Workload Identity Federation flow. Never commit the JSON key. The runtime identity needs only the Firebase Authentication token-verification permissions required by the Admin SDK.

## API contract

The frontend sends `Authorization: Bearer <Firebase ID token>` to the Go API. The API verifies the token server-side and uses the Firebase UID as the principal subject. User tokens do not grant Kubernetes, EC2, EKS or AWS IAM access; those systems continue to use workload identity, IAM roles and Kubernetes RBAC.

## Local development fallback

A high-entropy `CLOUDSENTINELS_LOCAL_AUTH_TOKEN` can be used for isolated local development. Production rejects this fallback unless explicitly enabled. It is not a Firebase account and should not be enabled in production.

## Fail-closed behavior

- Protected API routes return HTTP 503 when no Firebase verifier or local development credential is configured.
- Missing, malformed, expired, revoked or wrong-project Firebase ID tokens are rejected with HTTP 401.
- Firebase project ID and service-account credentials remain server-side.
