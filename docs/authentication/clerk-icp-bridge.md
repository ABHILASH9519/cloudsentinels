# CloudSentinels authentication: Clerk + ICP

## Current implementation

The Clerk browser sign-in UI is active on the `feat/clerk-authentication` branch. After sign-in, frontend canister operations are routed through the same-origin Vercel Function at `/api/canister`; the browser no longer constructs an Internet Computer identity or calls the protected canister directly.

The gateway:
1. Accepts a Clerk session JWT only in the Authorization bearer header.
2. Verifies the RS256 signature against the Clerk instance JWKS.
3. Checks issuer, expiry, not-before, issued-at, session ID, subject, and the exact authorized-party allowlist.
4. Retrieves the Clerk session from the Backend API and requires an active session whose user ID matches the JWT subject.
5. Derives a deterministic Ed25519 ICP identity from the verified Clerk subject and the server-only `ICP_GATEWAY_IDENTITY_SECRET`.
6. Registers that identity as a regular canister user and invokes only an explicit allowlist of application methods.
7. Returns JSON with explicit BigInt encoding; responses are marked `no-store`.

The browser receives neither the derived private key nor the server-side identity secret. A different Clerk user derives a different ICP principal.

## Data isolation

The Motoko backend now tracks owner principals separately for incidents, comments, metrics, and alerts while preserving the existing public Candid record shapes. List, detail, update, delete, comment, metric, alert, and dashboard operations are scoped to the calling principal. A caller cannot read or mutate another user's records by guessing a numeric ID.

Clerk users are currently provisioned as regular users. Administrator provisioning and role-based admin workflows remain a separate, explicit operation; the browser cannot assign roles. Incident deletion is permitted only for the incident owner.

## Required server environment

Set these values in the Vercel project for the preview environment, scoped to `feat/clerk-authentication` where supported:

- `CLERK_SECRET_KEY`: Clerk development instance secret key. Server-only.
- `CLERK_ISSUER`: exact Clerk JWT issuer, e.g. `https://your-instance.clerk.accounts.dev`.
- `CLERK_AUTHORIZED_PARTIES`: comma-separated exact HTTPS origins permitted in the Clerk `azp` claim. Use the stable Vercel branch alias and any explicitly approved development origin.
- `ICP_BACKEND_CANISTER_ID`: actual backend canister ID from the project's ICP deployment.
- `ICP_GATEWAY_IDENTITY_SECRET`: cryptographically random secret of at least 32 characters. Server-only. It deterministically derives per-user ICP identities; changing it changes every user's principal and requires a planned identity/data migration.
- `ICP_HOST`: normally `https://icp-api.io`.

The existing `VITE_CLERK_PUBLISHABLE_KEY` remains browser-visible by design. Never prefix a secret with `VITE_`, commit it, send it in browser JSON, or paste it into chat.

## Security limitations and rollout gates

- The gateway's JWT verification is intentionally strict to RS256 and the configured issuer/authorized-party set. Confirm the Clerk instance is issuing RS256 session JWTs.
- The gateway checks live Clerk session status on each request; transient Clerk Backend API failures fail closed.
- Per-user identity derivation relies on the secrecy and long-term retention of `ICP_GATEWAY_IDENTITY_SECRET`. Back it up in a secret manager; do not rotate it casually.
- All accounts currently receive the regular-user role. Admin role provisioning is not yet implemented.
- The canister owner maps must be preserved across upgrades. Before production upgrades, convert these maps and existing application state to stable structures and test upgrade migration.
- Add rate limits, audit logs, request timeouts, and browser E2E tests for sign-up, sign-in, session restore, invalid/expired/revoked tokens, cross-user isolation, and sign-out.
- Do not deploy to ICP mainnet or enable production Clerk credentials until these tests and state-upgrade protections pass.

## Local development

Set browser-visible and server-only values in a local environment file. Do not commit the file. Vercel Functions require the same server-only variables to be configured in Vercel; Vite's development proxy does not emulate the deployed serverless gateway automatically.

## Status

- [x] Clerk development application and frontend sign-in UI.
- [x] Server-side Vercel gateway endpoint.
- [x] Clerk JWT signature and claims validation.
- [x] Live Clerk session status verification.
- [x] Deterministic per-user ICP identity derivation.
- [x] Per-user ownership checks for canister data.
- [x] Frontend API proxy and post-login workspace route.
- [ ] Configure server-only Vercel environment variables.
- [ ] Confirm backend canister ID and gateway connectivity.
- [ ] Verify CI compilation and deployment of the API function.
- [ ] Browser end-to-end tests and administrator provisioning.
- [ ] Stable-state upgrade strategy and production security review.
