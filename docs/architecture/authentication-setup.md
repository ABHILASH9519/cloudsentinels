# CloudSentinels authentication setup

The Go API supports two identity paths behind one authentication interface.

## AWS Cognito (online server / serverless)

Set both values:

- `COGNITO_ISSUER_URL=https://cognito-idp.<region>.amazonaws.com/<user-pool-id>`
- `COGNITO_APP_CLIENT_ID=<app-client-id>`

The service discovers the issuer's OIDC signing keys and verifies the JWT signature, issuer, expiry and app-client audience using the OIDC verifier. The API accepts Cognito **ID tokens** (the `token_use` claim is checked when present), not arbitrary unsigned headers or raw AWS credentials. Map Cognito groups to application roles using the `cognito:groups` claim.

The browser must never receive AWS secret access keys. Use IAM roles / workload identity for server-side AWS API access; Cognito authenticates the user, it does not replace the server's AWS execution role.

## Local development / offline Kubernetes

Generate a high-entropy token locally and inject it through the environment:

```sh
openssl rand -hex 32
```

Set `CLOUDSENTINELS_LOCAL_AUTH_TOKEN` to the generated value. The local credential path is enabled by default in development, but production rejects it unless `CLOUDSENTINELS_ALLOW_LOCAL_AUTH_IN_PROD=true` is explicitly set. Never commit the generated token or place it in frontend source, a URL, or a Zapier workflow.

The local token currently represents one local operator principal. It is a bootstrap credential, not a substitute for per-user identity, Kubernetes RBAC, or audit attribution.

## Fail-closed behavior

- If no authenticator is configured, protected incident routes return HTTP 503.
- If credentials are missing, malformed, expired, signed by an unknown key, or have the wrong issuer/audience, the API returns HTTP 401.
- Partial Cognito configuration fails startup.
- Production local-token configuration fails startup unless explicitly opted in.
- Public health/readiness/platform metadata endpoints remain available for probes.

## Review limitations

The Go incident repository is process-memory storage and is not durable across process restarts. The React browser login uses Cognito Authorization Code + PKCE and the Go API validates ID tokens. Cognito groups are surfaced as roles but are not yet enforced through fine-grained authorization policies. Durable audit logging and the production EKS service-account/Pod Identity configuration remain explicit production gates.
