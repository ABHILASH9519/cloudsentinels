# Airtable monitoring + Zapier + agent review checklist

## What is included

- React `/clusters` dashboard with inventory, status, ready-node/pod, CPU, memory, data provenance, AI and automation panels.
- `/ai-insights` page with evidence-backed cluster findings.
- Go API with Airtable snapshot/live adapter, monitoring summary, explainable rules analysis, Cognito/local auth, signed Zapier events/commands, and agent telemetry/command routes.
- Go desktop agent with fixed kubectl allowlist and optional in-cluster Deployment/RBAC templates.
- Go API Gateway/Lambda adapter and SAM template.
- Per-cluster agent token binding, command ID validation, duplicate protection and two-minute agent lease retry.
- Default-deny mutation gates and post-restart rollout verification.

## Airtable source quality

The connected Airtable base currently contains 20 cluster records and 15 node records. None of the node records link to a cluster. The latest Node Last Seen timestamps are historical (June 2024). Cluster-level CPU, memory, node and pod values are inventory-reported fields, not a live metrics stream.

The API deliberately excludes the Airtable API Endpoint field from its fetch allowlist and never uses Airtable data as a connection target. A real agent must register with an Airtable record ID and authenticated token to publish live telemetry.

## Local verification

Run from the repository root:

```powershell
gofmt -w cmd internal
go test -race -cover ./...
go vet ./...
$env:CGO_ENABLED = "0"
go build -trimpath ./cmd/cloudsentinels
go build -trimpath ./cmd/cloudsentinels-agent
$env:GOOS = "linux"
$env:GOARCH = "arm64"
go build -tags lambda.norpc -trimpath -o bootstrap ./cmd/cloudsentinels-lambda
```

Frontend:

```powershell
pnpm typecheck
pnpm check
pnpm build
```

The connected Windows desktop passed these Go and frontend checks. The Lambda ARM64 bootstrap cross-build passed. The local Docker daemon was unavailable, so API and agent container builds are delegated to GitHub Actions.

## Start the online API

Copy `.env.example` to a private local environment file or set environment variables in your shell. At minimum, configure a local operator token and a dedicated agent token for development. The frontend must use a valid Cognito ID-token session and `VITE_CLOUDSENTINELS_API_URL`; do not expose local/server tokens through VITE_ variables.

```powershell
go run ./cmd/cloudsentinels
```

The service serves the checked-in Airtable snapshot unless `AIRTABLE_API_TOKEN` is configured. The UI disables manual Airtable refresh while the server is in snapshot mode.

## Connect the local Kubernetes agent

Requirements: Docker Desktop/Minikube or a working local kubeconfig context, plus a reachable Go API.

```powershell
go build -trimpath -o cloudsentinels-agent.exe ./cmd/cloudsentinels-agent
$env:CLOUDSENTINELS_API_URL = "http://127.0.0.1:8080"
$env:CLOUDSENTINELS_AGENT_CLUSTER_ID = "minikube"
$env:CLOUDSENTINELS_AGENT_CONTEXT = "minikube"
$env:CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS = "false"
.\cloudsentinels-agent.exe
```

This desktop currently has no active Docker Desktop Linux engine; Minikube is stopped. Therefore no real local cluster metrics were collected during this review.

For remote clusters, use the in-cluster deployment and read-only RBAC in `deploy/agent/kubernetes/`. Configure one unique token per Airtable record ID in `CLOUDSENTINELS_AGENT_TOKENS`.

## Zapier

- Set server-side `ZAPIER_CATCH_HOOK_URL` and `ZAPIER_SIGNING_SECRET`.
- Use the UI's **Test Zapier** action to verify outbound delivery.
- Inbound commands must use HMAC-SHA256 over `timestamp + "." + exact JSON body` with the `X-CS-Timestamp` and `X-CS-Signature` headers.
- Use `collect-snapshot` for a read-only test.
- The local CLI command queue is available only on the persistent online-server API; the Lambda adapter intentionally rejects local command enqueueing.

## Required external configuration still outstanding

- [ ] Cognito issuer and app-client ID configured and tested.
- [ ] Airtable PAT configured server-side; live sync verified.
- [ ] Zapier Catch Hook URL and HMAC secret configured; delivery verified.
- [ ] Go API deployed to an HTTPS endpoint with a durable command/telemetry store.
- [ ] AWS credentials/role configured; SAM Lambda stack deployed.
- [ ] Docker Desktop/Minikube started, or target cluster agents deployed with per-cluster credentials.
- [ ] GitHub Actions Docker image build passes on the new PR.
- [ ] Mutations remain disabled until scoped RBAC, approval and rollback procedures are verified.

## Production caveats

The command queue and telemetry cache are process-memory only. AI is a deterministic rules engine, not a trained model. The Lambda adapter is buildable but not deployed. No external cluster endpoint is trusted solely because it appears in Airtable. Do not claim production monitoring or remediation until the above checks are complete.
