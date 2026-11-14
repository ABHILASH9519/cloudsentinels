# CloudSentinels Firebase Authentication

Firebase Authentication is the interactive user identity provider. The web client signs users in with Firebase; it sends the resulting Firebase ID token to the Go API over HTTPS. The API verifies token signature, issuer, audience, expiry and revocation with Firebase Admin Go SDK before serving protected routes.

## Firebase Console setup

1. Select or create the CloudSentinels Firebase project.
2. Open **Authentication ? Sign-in method** and enable the providers required by the product (recommended initial providers: Email/Password and Google).
3. Register the CloudSentinels web application under **Project settings ? General ? Your apps**.
4. Add local and production hostnames under **Authentication ? Settings ? Authorized domains**.
5. Copy the web app's public configuration into the frontend build environment: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_APP_ID`.

The web API key and app identifiers are public client configuration. Never put a service-account JSON, private key, Airtable PAT, agent token or signing secret in a `VITE_*` variable.

## Go API configuration

Set `FIREBASE_PROJECT_ID` (or `GOOGLE_CLOUD_PROJECT`) to the Firebase project ID. The Admin SDK supports:

- **Local development:** `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service-account JSON file stored outside the repository; or `FIREBASE_SERVICE_ACCOUNT_JSON` supplied through a private environment/secret store.
- **AWS production:** prefer workload identity federation or a narrowly scoped service-account credential injected from AWS Secrets Manager at runtime. Do not commit credentials or bake them into images.
- **Google Cloud runtime:** use Application Default Credentials with the runtime service identity.

Only one of `GOOGLE_APPLICATION_CREDENTIALS` and `FIREBASE_SERVICE_ACCOUNT_JSON` may be configured. The service-account project must match `FIREBASE_PROJECT_ID`.

## API contract

After Firebase sign-in, the client obtains `await user.getIdToken()` and calls the Go API with `Authorization: Bearer <ID_TOKEN>`. `GET /api/v1/auth/me` returns the verified UID, email and role claims. The Go API uses `VerifyIDTokenAndCheckRevoked`, so revoked sessions and disabled users are rejected. Missing, malformed, expired, revoked or wrong-project tokens return HTTP 401. If no verifier is configured, protected routes fail closed with HTTP 503.

Firebase authentication identifies the user; it does not grant Kubernetes or AWS permissions. Cluster agents continue using per-cluster credentials and Kubernetes RBAC. AWS resources continue using IAM roles. Never trust a role supplied by the browser: roles must be assigned as Firebase custom claims by a trusted administrative process.

## Local-only fallback

`CLOUDSENTINELS_LOCAL_AUTH_TOKEN` remains available for isolated development and is rejected in production unless explicitly enabled. It is not a Firebase account. Keep it disabled in production.

## Frontend integration contract

Use the Firebase Web modular SDK (`initializeApp`, `getAuth`, `onAuthStateChanged`, `signInWithEmailAndPassword`, `createUserWithEmailAndPassword`, `GoogleAuthProvider`, `signInWithPopup`, `sendPasswordResetEmail`, `signOut`). Keep the Firebase app singleton. On each API request, obtain the current user's ID token and attach it as a Bearer token; do not persist ID tokens in custom localStorage/sessionStorage. Handle `onAuthStateChanged` for loading, signed-out and signed-in states. The React implementation lives in `src/frontend/src/auth/FirebaseAuth.tsx`; its existing provider supports Google popup sign-in, email/password sign-in and account creation. API clients obtain a fresh Firebase ID token from the current user for each request.
