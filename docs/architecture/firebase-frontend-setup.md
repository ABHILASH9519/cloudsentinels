# Firebase Authentication — Frontend setup

The React/Vite frontend uses the Firebase Web modular SDK. The Firebase Web App configuration is public client configuration; it is not a service-account credential. Never place a Firebase Admin service-account private key in `VITE_*` variables or frontend source.

## 1. Create/configure the Firebase Web app

1. Open the Firebase console and select the CloudSentinels Firebase project (or create the project intended for this deployment).
2. In **Project settings → General → Your apps**, register a **Web app** and copy its SDK configuration.
3. Under **Authentication → Sign-in method**, enable **Google** and **Email/Password**. Configure the Google support email when prompted.
4. Under **Authentication → Settings → Authorized domains**, add the exact frontend hostnames used for development and deployment (for example `localhost` and your production domain). Do not add wildcard domains.

## 2. Configure the local frontend

Copy the values from the Firebase Web App config into `src/frontend/.env.local`:

```dotenv
VITE_FIREBASE_API_KEY=your-web-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_APP_ID=your-web-app-id
VITE_CLOUDSENTINELS_API_URL=http://127.0.0.1:8082
```

These four `VITE_FIREBASE_*` values are required. They are client-side Firebase identifiers/configuration, not an Admin SDK credential. Keep `.env.local` untracked; never commit real credentials or tokens. Restart Vite after changing environment variables.

## 3. API token flow

After Firebase reports an authenticated user, the frontend obtains a Firebase ID token with `user.getIdToken()` and sends it as `Authorization: Bearer <token>` to the Go API. The Go API must be configured with the matching `FIREBASE_PROJECT_ID` and Firebase Admin credentials (or workload identity) so it can verify tokens for the same project. Do not use the Web API key as an API bearer token.

## 4. Run and verify

From `src/frontend`:

```powershell
pnpm install
pnpm typecheck
pnpm build
pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://localhost:5173`. Verify that the login page no longer reports missing Firebase configuration, test Google sign-in and email/password sign-in with a test account, then verify that the Go API accepts the resulting ID token at `GET /api/v1/auth/me`.

## 5. Troubleshooting

- `auth/unauthorized-domain`: add the exact browser hostname under Authentication → Settings → Authorized domains.
- `auth/operation-not-allowed`: enable the corresponding provider in Authentication → Sign-in method.
- `auth/popup-blocked` or `auth/popup-closed-by-user`: allow popups and retry; use the configured redirect flow if the deployment environment blocks popups.
- API returns `401`: check that the Go API uses the same Firebase project ID as the frontend and that the ID token is current.
- API returns `503`: Firebase Admin verification is not configured on the Go API.

The Firebase project itself cannot be activated from source code alone: a project, Web App config, enabled providers, and authorized domains must exist in the Firebase console.
