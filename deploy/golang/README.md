# CloudSentinels Go services

## API server

```powershell
go test -race ./...
go run ./cmd/cloudsentinels
```

The API listens on `:8080` by default. It serves the sanitized Airtable snapshot and periodically refreshes directly from Airtable when `AIRTABLE_API_TOKEN` is configured.

## Services

| Binary | Purpose |
|---|---|
| `cmd/cloudsentinels` | Online Go HTTP API, inventory sync, monitoring, AI triage, Zapier webhooks and desktop-agent command broker |
| `cmd/cloudsentinels-lambda` | API Gateway HTTP API adapter for the same shared Go handlers in Lambda |
| `cmd/cloudsentinels-agent` | Desktop/cluster-adjacent agent using fixed kubectl arguments only |

## Execution modes

- `online-server`: persistent Go API; local agent command broker and telemetry cache live in this process.
- `online-serverless`: API Gateway/Lambda adapter; shared inventory/monitoring/analysis API. Do not use it as the local CLI command queue because Lambda memory is ephemeral.
- `offline-kubernetes`: desktop agent reads a local kube context and sends telemetry outbound to the online-server API.

## Airtable and monitoring endpoints

- `GET /api/v1/inventory/clusters`
- `POST /api/v1/inventory/refresh`
- `GET /api/v1/monitoring/summary`
- `GET /api/v1/ai/insights`
- `POST /api/v1/ai/analyze`

The cluster inventory includes 20 Airtable cluster rows in the checked-in sanitized snapshot. The Airtable adapter fetches only an explicit allowlist of cluster and node fields; API endpoints and credential-like fields are never requested. Node/pod child-table data is not treated as live because current Airtable links are incomplete and timestamps are historical.

## Zapier and local CLI automation

- Outbound Catch Hook: set `ZAPIER_CATCH_HOOK_URL` and `ZAPIER_SIGNING_SECRET`.
- Inbound signed command: `POST /api/v1/zapier/commands` on the online-server API.
- Agent endpoints: `GET /api/v1/agent/commands?clusterId=...`, `POST /api/v1/agent/commands/{id}/result`, and `POST /api/v1/agent/telemetry`.
- Agent authentication uses a separate 32+ character `CLOUDSENTINELS_AGENT_TOKEN`.
- CLI allowlist: `collect-snapshot`, `rollout-status`, and approval-gated `restart-deployment`. No arbitrary shell execution is supported.

Mutations are disabled unless both server and local agent explicitly set `CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS=true`; a restart also requires a signed Zapier request with `approvalStatus=approved` and `approvedBy`. Keep the default false.

## Production boundary

This is an integration milestone, not yet a complete production deployment:
- Inventory and local telemetry caches and the CLI command queue are in-memory/process-local.
- Lambda uses the same API handlers, but local command queue and agent telemetry must remain on the persistent online-server or be moved to SQS/DynamoDB before multi-instance production use.
- The AI triage is an explainable deterministic rules engine, not a trained ML/LLM inference service. It is advisory and cannot authorize actions.
- The Lambda SAM template is buildable but not deployed from this desktop.
- Live Airtable refresh needs a server-side PAT; this desktop does not currently have one configured.
- Live Zapier delivery needs a Catch Hook URL and signing secret.
- Local Minikube is stopped because the Docker Desktop Linux engine is unavailable; no real local cluster metrics have been collected in this session.

See the [Airtable + Zapier + desktop agent integration](../../docs/integrations/airtable-zapier-desktop-agent.md) and [final-review checklist](../../docs/review/airtable-monitoring-final-review.md) for setup and acceptance gates.
