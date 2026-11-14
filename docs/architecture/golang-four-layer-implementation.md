# CloudSentinels Go four-layer architecture

## Objective

CloudSentinels is a Go-first control plane for Airtable-backed cluster inventory, live Kubernetes telemetry, explainable health analysis and approval-gated automation. React/TypeScript is the presentation layer.

## Layer 1 — UI and execution modes

1. Online server: persistent Go HTTP API for inventory, monitoring, analysis and command brokering.
2. Online serverless: Go API Gateway/Lambda adapter built for Linux ARM64. The existing deployed AWS Operations API remains a separate runtime and has not yet been replaced by the Go Lambda binary.
3. Local/remote Kubernetes: Go agent uses the configured kube context and fixed kubectl arguments. Docker-backed Minikube is the local operational cluster; CoreDNS and metrics-server are Ready, and kubectl top nodes returns live node CPU/memory. EKS provisioning is scheduled through the protected review-day workflow.

## Layer 2 — Identity and credentials

- Web users authenticate with Firebase Authentication; the Go API verifies Firebase ID tokens and revocation with the Firebase Admin SDK.
- Local development auth is a high-entropy operator token and must remain disabled in production.
- Cluster agents use unique bearer tokens, preferably mapped by Airtable record ID.
- Zapier inbound commands use timestamped HMAC-SHA256 signatures.
- Kubernetes RBAC is read-only by default; restart requires an explicit human approval and scoped namespace permissions.

Never place Airtable PATs, agent tokens, Cognito secrets, kubeconfig or Zapier signing secrets in frontend variables, source control, UI payloads or logs.

## Layer 3 — Shared Go core

The Go API exposes:
- GET /api/v1/inventory/clusters
- POST /api/v1/inventory/refresh
- GET /api/v1/monitoring/summary
- GET /api/v1/ai/insights
- POST /api/v1/ai/analyze
- POST /api/v1/agent/telemetry

The Airtable adapter reads the allowlisted 20-cluster inventory snapshot. The same exact snapshot is mounted into the local Kubernetes inventory service. Agent telemetry is kept separate from Airtable metadata and merged by Airtable record ID when a cluster agent is registered.

The Go agent reports node readiness, pod readiness, warning events, CPU and memory. The analysis engine is explainable deterministic rules; it is not a trained ML/LLM model.

## Layer 4 — Zapier automation

Application event delivery uses the Go API's ZAPIER_CATCH_HOOK_URL and ZAPIER_SIGNING_SECRET settings. Inbound command callbacks are HMAC-verified and restricted to the documented command allowlist. The GitHub Actions Go CI workflow also includes the requested gpuliyar/zapier-webhook-action@v1.0.0 step after Go and frontend checks; it requires the repository secret ZAPIER_WEBHOOK_ID.

## Current implementation and readiness

| Component | Code status | External readiness |
|---|---|---|
| React dashboard | Typecheck, lint and production build pass | Requires Cognito and configured API endpoints |
| Go HTTP API | Implemented; local health/readiness verified | Public EC2 hosting and durable storage remain separate tasks |
| Airtable inventory | Sanitized 20-row snapshot mounted locally | Live PAT refresh requires the server-side Airtable token |
| Local Kubernetes | Docker-backed Minikube and read-only Go agent | Local node/pod telemetry can be verified while cluster is running |
| EKS | Protected plan/execute workflow and CloudFormation template | No EKS cluster provisioned yet |
| Go Lambda adapter | ARM64 cross-build passes | Not deployed as the active AWS Operations API |
| AWS hosted runtime | API Gateway/Lambda health verified in ap-south-1 | Supporting Node.js event/automation workers remain in place |
| Zapier | GitHub Actions step committed; Go HMAC integration implemented | GitHub secret and application Catch Hook/signing secret still need configuration |
| AI analysis | Explainable rules engine implemented | Not an ML/LLM model |
| Command queue / telemetry cache | Per-cluster auth and bounded commands implemented | In-memory; move to SQS/DynamoDB before production multi-replica use |

## Production acceptance gates

1. Configure Cognito issuer/app client and verify real user tokens.
2. Configure Airtable PAT in the server environment or Secrets Manager and verify refresh.
3. Configure GitHub Actions ZAPIER_WEBHOOK_ID and application ZAPIER_CATCH_HOOK_URL / ZAPIER_SIGNING_SECRET; verify real deliveries.
4. Deploy the Go server behind HTTPS and move command/telemetry storage to durable services.
5. Deploy EKS only after owner approval, network/IAM review and cost approval.
6. Deploy the Go agent into EKS with a unique cluster credential and read-only RBAC.
7. Verify telemetry freshness and independent health checks.
8. Keep mutations disabled until approval, namespace-scoped RBAC, rollout verification and rollback procedures are reviewed.

See [Airtable, Zapier and desktop-agent operations](../integrations/airtable-zapier-desktop-agent.md).
