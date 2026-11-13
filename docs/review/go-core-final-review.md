# CloudSentinels Go core — current review runbook

This runbook describes the current Go-first control plane and checks that can be reproduced. It does not claim that every external integration is production-ready.

## Active implementation

- Go HTTP API for cluster inventory, monitoring, explainable analysis, agent telemetry and signed Zapier command ingress.
- Go Kubernetes agent with fixed kubectl allowlist, per-cluster bearer credentials and optional signed Lambda event forwarding.
- Go AWS Lambda adapter compiled for Linux ARM64; the deployed AWS Operations API still contains Node.js workers and is not yet replaced by the Go adapter.
- Cognito OIDC browser sign-in using Authorization Code + PKCE; the Go API validates Cognito ID tokens.
- React/TypeScript dashboard; the frontend is a presentation layer, not a backend runtime.
- Docker-backed local Kubernetes manifests and a read-only agent deployment.
- GitHub Actions Go/UI validation and optional Zapier CI notification through gpuliyar/zapier-webhook-action@v1.0.0.

## Known production boundaries

- The Go API's incident repository, command queue and telemetry cache are process-local. They are not durable across restarts and are not safe for horizontal scaling until migrated to DynamoDB/SQS with audit history.
- Airtable snapshot contains the exact sanitized 20 cluster records; Airtable-reported CPU/memory is inventory metadata, not streaming metrics.
- Local Docker-backed Minikube agent telemetry is real when the cluster and agent are running. EKS has not yet been provisioned.
- Application-level Zapier delivery requires ZAPIER_CATCH_HOOK_URL and ZAPIER_SIGNING_SECRET. GitHub Actions notification requires the repository secret ZAPIER_WEBHOOK_ID.
- The AI triage engine is explainable deterministic rules, not a trained ML model or LLM.
- Mutating Kubernetes actions remain disabled by default and require explicit approval plus scoped RBAC.

## Reproducible checks

From the repository root:

```powershell
gofmt -w cmd internal
go test -race ./...
go vet ./...
go build -trimpath ./cmd/cloudsentinels
go build -trimpath ./cmd/cloudsentinels-agent
```

Cross-build the Go Lambda adapter:

```powershell
$env:GOOS = "linux"
$env:GOARCH = "arm64"
$env:CGO_ENABLED = "0"
go build -tags lambda.norpc -trimpath -o $env:TEMP\cloudsentinels-lambda-bootstrap ./cmd/cloudsentinels-lambda
```

Frontend checks:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm check
pnpm build
```

## EKS deployment gates

Use the protected manual workflow only after the owner has approved the AWS account, region, VPC/subnets, EKS version, node sizing, endpoint allowlist, IAM roles and cost envelope. Plan and execute are separate workflow operations. The same sanitized Airtable snapshot is used by the local Kubernetes inventory service and will be mounted into EKS; live Kubernetes telemetry is collected separately by the Go agent.
