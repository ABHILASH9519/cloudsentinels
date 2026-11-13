# CloudSentinels Go four-layer architecture

## Objective

CloudSentinels is a DevOps web application service with one shared Go control plane and three execution modes. The React/TypeScript application remains the presentation layer. Go owns inventory normalization, monitoring APIs, explainable analysis, signed workflow events and the fixed-command desktop/cluster agent.

## Layer 1 — UI and execution modes

1. **Online / server:** persistent Go HTTP API. This is the command broker for local and in-cluster agents.
2. **Online / serverless:** Go API Gateway HTTP API + Lambda adapter using the same Go handlers and analysis package. It supports inventory, monitoring, AI triage and outbound Zapier notifications. It deliberately rejects local CLI command enqueueing because Lambda memory is ephemeral.
3. **Offline / local Kubernetes:** Go desktop agent uses the selected local kubeconfig context and fixed kubectl arguments. An optional in-cluster deployment template supports remote clusters and sends telemetry outbound to the online-server API.

The React route `/clusters` displays Airtable inventory, cluster health, node/pod/CPU/memory metrics, source/freshness and execution-mode readiness. `/ai-insights` displays evidence and recommended checks.

## Layer 2 — Identity and credentials

- **Web user:** Cognito OIDC ID-token verification (issuer, signature, expiry and app-client audience). Protected routes fail closed if no authenticator is configured.
- **Local development:** high-entropy local operator bearer token with constant-time comparison and production guard.
- **Cluster agents:** dedicated agent bearer token, optionally mapped per Airtable cluster record ID through `CLOUDSENTINELS_AGENT_TOKENS`. If the per-cluster map is configured, the global token fallback is disabled.
- **Zapier:** timestamped HMAC-SHA256 verification on inbound command callbacks; signed outbound event payloads.
- **Kubernetes:** use a least-privilege kubeconfig or service account. The provided ClusterRole is read-only; an optional namespace-scoped Role adds deployment patch permission for an explicitly approved namespace.

Never put Airtable PATs, agent tokens, Cognito secrets, kubeconfig or Zapier signing secrets in VITE_ variables, source control, UI payloads or logs.

## Layer 3 — Shared CloudSentinels core

### Airtable inventory

The Airtable adapter reads an explicit field allowlist from the Cloud-Sentinel base:
- 20 cluster inventory rows from the Clusters table.
- 15 Nodes rows from the related table.
- Current Nodes records have zero cluster links; their latest Last Seen timestamps are historical. The snapshot is therefore inventory, not live Kubernetes telemetry.
- The adapter does not request or use the Airtable API Endpoint field as a connection target.

Without a server-side `AIRTABLE_API_TOKEN`, the API serves the sanitized snapshot at `deploy/eks/airtable-inventory.snapshot.json`. With the PAT configured, the online server refreshes on startup and at the configured interval; Lambda refreshes on cold start.

### Monitoring and analysis

The Go API exposes:
- `GET /api/v1/inventory/clusters`
- `POST /api/v1/inventory/refresh`
- `GET /api/v1/monitoring/summary`
- `GET /api/v1/ai/insights`
- `POST /api/v1/ai/analyze`

A desktop/in-cluster agent reports ready nodes, pods, ready pods, warning events, CPU and memory metrics. Agent telemetry is merged into the matching Airtable row by record ID; a separate local cluster is added when no Airtable row matches. Telemetry older than two minutes is marked offline.

The current analysis is an explainable deterministic rules engine using reported health, status, CPU and agent freshness. It is **not** a trained ML/LLM inference model. It provides evidence and recommended checks; it never grants permission or executes a remediation.

### Local execution and command safety

The agent accepts only:
- `collect-snapshot` — read-only metrics collection;
- `rollout-status` — read-only deployment rollout status;
- `restart-deployment` — mutating restart followed by rollout-status verification.

The restart action requires a signed Zapier command, `approvalStatus=approved`, an `approvedBy` identity, server-side mutation opt-in, local-agent mutation opt-in and namespace-scoped Kubernetes patch permission. Arbitrary shell, PowerShell, scripts, delete, scale, exec, apply and credential export are not accepted.

## Layer 4 — Zapier automation

Outbound event types include:
- `incident.created` from the online API;
- `cluster.ai_finding` for high/critical analysis findings (cooldown protected);
- `cluster.warning` for warning telemetry from the desktop/in-cluster agent;
- `cloudsentinels.integration_test` from the UI test action.

Inbound Zapier Webhooks POST signed JSON to `/api/v1/zapier/commands`. Zapier can request a read-only snapshot or, only after an explicit approval step, request a named deployment restart. The persistent online-server API brokers commands to the correct cluster agent. The Lambda adapter rejects local command enqueueing.

Zapier is a workflow adapter, not the authorization authority. CloudSentinels validates HMAC freshness, action allowlist, target cluster, approval fields, mutation policy and agent credential before execution.

## Current implementation and readiness

| Component | Code status | External readiness |
|---|---|---|
| React cluster dashboard and AI findings | Implemented; typecheck/lint/build pass locally | Requires Cognito config and Go API URL |
| Airtable snapshot adapter | Implemented; 20 rows loaded | Snapshot mode until a server-side Airtable PAT is configured |
| Live Airtable adapter | Implemented with field allowlist and pagination | Not tested against the API from this desktop because no PAT is configured |
| Online Go server | Implemented and locally built | Not deployed to a public HTTPS endpoint |
| Go Lambda adapter + SAM template | Implemented and ARM64 cross-build passes | Not deployed; AWS identity is unavailable in the connected desktop |
| Desktop/in-cluster agent | Implemented and locally built; Kubernetes manifests supplied | Not connected; Minikube/Docker Desktop engine is stopped |
| Zapier outbound/inbound HMAC | Implemented | Needs Catch Hook URL and signing secret |
| AI analysis | Explainable rules engine implemented | No external LLM provider connected |
| Command queue / telemetry | In-memory implementation with per-cluster agent auth and lease retry | Must move to durable SQS/DynamoDB before production/multi-replica use |

## Production acceptance gates

1. Configure Cognito issuer/app client and verify real tokens.
2. Configure Airtable PAT in the server environment or Secrets Manager; verify live refresh and freshness.
3. Configure Zapier Catch Hook URL and signing secret; test inbound and outbound deliveries.
4. Deploy the Go server behind HTTPS and durable command/telemetry storage.
5. Deploy the Go Lambda adapter only for stateless inventory/analysis/notifications; keep the agent command broker on persistent online-server until SQS/DynamoDB is connected.
6. Start Minikube/Docker Desktop or deploy the agent into each target cluster with unique per-cluster tokens and read-only RBAC.
7. Validate monitoring against real cluster metrics, then add durable audit history and policy/role authorization.
8. Keep mutations disabled until approval, namespace-scoped RBAC, rollout verification and rollback procedures are reviewed.
9. Complete staging, failure drills and rollback before retiring legacy Node/Motoko services.

See [Airtable, Zapier and desktop-agent operations](../integrations/airtable-zapier-desktop-agent.md) for configuration and runbooks.
