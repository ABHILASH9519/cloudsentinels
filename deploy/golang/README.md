# CloudSentinels Go service

This directory contains the first Go runtime slice for the four-layer architecture.

## Run locally

```sh
go test ./...
go run ./cmd/cloudsentinels
```

The service listens on `:8080` by default.

## Execution modes

Set `CLOUDSENTINELS_EXECUTION_MODE` to one of:

- `online-server`
- `online-serverless`
- `offline-kubernetes`

Other settings:

- `CLOUDSENTINELS_HTTP_ADDR` (default `:8080`)
- `CLOUDSENTINELS_ENV` (default `development`)
- `CLOUDSENTINELS_VERSION` (default `dev`)

## Current implementation boundary

The health, readiness and platform-capability endpoints are live. Incident endpoints are intentionally fail-closed until an AWS Cognito or local-session authenticator is wired into the server. The current incident collection is process-memory demo storage and is not durable or suitable for multi-replica production use.

The next slices are: Cognito JWT/JWKS verification, local session and kubeconfig credential adapters, durable PostgreSQL/DynamoDB repositories, Kubernetes client-go adapter, AWS SDK v2 adapters, the shared detection/analysis/policy engine, and signed Zapier event/approval integration.

Do not enable mutating remediation until target-scoped permissions, approval policy, idempotency, audit events, timeout handling and post-action verification are implemented and tested.
