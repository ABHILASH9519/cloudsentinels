# CloudSentinels Go core — final review runbook

This runbook describes the Go bootstrap and the exact checks reviewers can reproduce. It is not a claim that the full CloudSentinels product is production-ready.

## Scope in this review

Included:
- Go HTTP service bootstrap and three execution-mode identifiers.
- Cognito OIDC ID-token verifier (issuer discovery, signing-key validation, issuer, expiry and app-client audience).
- Development/offline local operator bearer token with constant-time comparison and production guard.
- Incident request validation, bounded JSON input, generated IDs, duplicate-ID protection and in-memory demo repository.
- Race-enabled Go tests, vet, static build and Docker image build in GitHub Actions.

Not yet implemented:
- Durable database/repository and audit event store.
- React sign-in/session integration and fine-grained role authorization.
- AWS SDK v2 runtime credential adapter / STS role assumption.
- AWS Lambda/serverless adapter and local Kubernetes client-go adapter.
- AI analysis provider, Zapier event/approval integration, and policy-gated remediation execution.

## Local setup

Requirements: Go 1.23 or newer.

PowerShell:

```powershell
$env:CLOUDSENTINELS_ENV = "development"
$env:CLOUDSENTINELS_EXECUTION_MODE = "online-server"
$env:CLOUDSENTINELS_HTTP_ADDR = "127.0.0.1:8080"
$env:CLOUDSENTINELS_LOCAL_AUTH_TOKEN = "replace-with-a-random-token-of-at-least-32-characters"
go run ./cmd/cloudsentinels
```

Generate a strong token rather than using the example value:

```powershell
$token = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:CLOUDSENTINELS_LOCAL_AUTH_TOKEN = $token
```

## Reproducible API checks

In a second PowerShell window:

```powershell
$base = "http://127.0.0.1:8080"
Invoke-RestMethod "$base/healthz"
Invoke-RestMethod "$base/readyz"
Invoke-RestMethod "$base/api/v1/platform"

# This must return HTTP 401 when an authenticator is configured but no bearer token is supplied.
try { Invoke-RestMethod "$base/api/v1/incidents" } catch { $_.Exception.Response.StatusCode }

$headers = @{ Authorization = "Bearer $env:CLOUDSENTINELS_LOCAL_AUTH_TOKEN" }
Invoke-RestMethod -Headers $headers "$base/api/v1/incidents"

$incident = @{
  title = "payments-api pod crash loop"
  description = "Repeated restarts observed in the local review environment"
  severity = "high"
  source = "manual-review"
  target = "offline-kubernetes"
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Headers $headers -ContentType "application/json" -Body $incident "$base/api/v1/incidents"
```

Expected results:
- Health, readiness and platform endpoints return HTTP 200.
- Protected routes return HTTP 503 if no authenticator is configured.
- Protected routes return HTTP 401 for missing or invalid credentials.
- Valid local bearer credentials allow incident list/create; new incidents receive an ID and default `open` status.
- Invalid enum values, unknown JSON fields, trailing JSON values, oversized bodies and duplicate IDs are rejected.

## CI checks

The Go workflow runs:
1. gofmt check
2. go vet
3. go test -race -cover
4. CGO-disabled Go build
5. Docker multi-stage image build

Local commands:

```powershell
gofmt -w cmd internal
go test -race -cover ./...
go vet ./...
$env:CGO_ENABLED = "0"
go build -trimpath ./cmd/cloudsentinels
docker build -f deploy/golang/Dockerfile -t cloudsentinels:review .
```

The connected Windows desktop did not have the Docker Desktop Linux engine running during this review pass. The Docker build is therefore delegated to the GitHub Actions runner and must be confirmed green there.

## Cognito configuration gate

Configure both `COGNITO_ISSUER_URL` and `COGNITO_APP_CLIENT_ID`. The issuer must be the HTTPS Cognito User Pool issuer URL. Use a Cognito ID token issued for that app client. Confirm group claim names and application role mapping against the actual pool. Never place AWS access keys or the local operator token in frontend code, source control, or Zapier.

## Production acceptance checklist

- [ ] Cognito token integration tested against the actual User Pool (valid, expired, wrong issuer, wrong audience, access-token rejection).
- [ ] Fine-grained role/policy checks added for incident operations.
- [ ] Durable storage, migrations, retention and audit history implemented.
- [ ] API rate limits, request IDs, metrics and structured status logging added.
- [ ] Serverless and Kubernetes execution adapters implemented and tested separately.
- [ ] AI analysis is advisory only and cannot authorize actions.
- [ ] Zapier signatures, approval scope, replay protection and idempotency verified.
- [ ] Remediation remains dry-run until least-privilege execution and post-action verification pass.
- [ ] End-to-end staging deployment, rollback and incident drill completed.

## Review order

Review the Go-core bootstrap PR first, then this authentication/API hardening PR. Do not merge a dependent PR until its base PR has been reviewed and merged or the PR is retargeted to the resulting base commit.
