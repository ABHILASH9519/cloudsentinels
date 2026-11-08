# CloudSentinels authentication: Clerk + ICP

## Current migration stage

The frontend sign-in provider is being migrated from Internet Identity to Clerk. The development Clerk application is provisioned. The browser SDK uses the public Clerk publishable key only; no Clerk secret key is shipped to the browser.

**Backend access remains fail-closed until the trusted authentication gateway is deployed.** A successful Clerk browser session is not, by itself, authorization to call the Motoko canister.

## Target trust boundary

1. The browser signs in with Clerk and obtains a short-lived Clerk session token.
2. A server-side gateway verifies the token signature, issuer, authorized party/origin, expiry, and session claims using Clerk's supported backend verification library and the Clerk JWKS.
3. The gateway maps the verified Clerk subject to an application user and enforces role policy. It must never accept a user ID or role asserted only by the browser.
4. The gateway calls the ICP canister using a dedicated gateway identity whose principal is explicitly allowlisted by the canister.
5. The canister accepts privileged gateway calls only from that principal and validates the user/operation context supplied by the gateway. The gateway signing key is stored only in the gateway's secret manager, never in the frontend or repository.
6. Direct anonymous/browser calls to protected canister methods remain rejected.

## Required implementation before enabling the workspace

- Create a server-side gateway (recommended: Vercel Functions or an equivalent managed HTTPS service).
- Add Clerk backend token verification and tests for invalid signature, wrong issuer/authorized party, expired token, revoked session, and missing token.
- Create a dedicated ICP gateway identity; store its private key as a server-side secret.
- Update Motoko authorization to trust only the configured gateway principal for gateway-only entry points; retain controller-only upgrade/admin controls.
- Pass the verified Clerk subject from the gateway, not from untrusted request JSON; enforce per-user data ownership and Admin/User roles inside the trusted backend path.
- Add integration tests covering cross-user isolation, role escalation attempts, replay, and direct canister access.
- Configure CORS/origin allowlists, rate limits, request size limits, audit logging, and secret rotation.
- Only then replace the temporary fail-closed post-login screen with the authenticated workspace.

## Development configuration

Set `VITE_CLERK_PUBLISHABLE_KEY` in `src/frontend/.env.local`. The publishable key is public and may be present in browser builds. Never put `CLERK_SECRET_KEY`, a gateway private key, or ICP seed material in a `VITE_*` variable.

The frontend currently loads the official ClerkJS and Clerk UI bundles from the Clerk Frontend API domain. A production Clerk instance and verified application domain are required before production rollout.

## Status

- [x] Clerk development application created.
- [x] Frontend Clerk session bootstrap and sign-in UI added on the migration branch.
- [x] Legacy Internet Identity UI removed from the active frontend entry path.
- [x] Post-login backend access is fail-closed pending gateway.
- [ ] Server-side Clerk verifier and ICP gateway.
- [ ] Motoko gateway-only authorization and per-user data model.
- [ ] Production Clerk instance, domain verification, and secret configuration.
- [ ] End-to-end security and browser acceptance tests.
