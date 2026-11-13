# CloudSentinels

**Cloud and Kubernetes observability with explainable incident triage and approval-gated response workflows.**

CloudSentinels brings cluster inventory, monitoring signals, health analysis and operational automation into one dashboard. The current submission path is a React dashboard backed by a Go API and a Kubernetes desktop/in-cluster agent.

> **Current delivery status:** the local online-server demo is runnable and verified. The serverless adapter is buildable but not deployed. Kubernetes telemetry, live Airtable sync and Zapier delivery require external services/credentials to be configured. Do not present snapshot inventory as live telemetry.

## Features

- **Cluster inventory:** 20 sanitized cluster records loaded from the checked-in Airtable snapshot; optional server-side Airtable API refresh.
- **Monitoring:** normalized cluster health, node/pod counts, reported CPU/memory and agent telemetry freshness.
- **Explainable AI triage:** deterministic rules inspect cluster health, CPU, state and missing telemetry; findings include evidence, confidence and recommended checks.
- **Kubernetes agent:** Go desktop/in-cluster agent collects node, pod, warning-event and resource metrics through a fixed `kubectl` allowlist.
- **Automation:** HMAC-signed Zapier webhook events and inbound commands; command queue supports read-only collection/status and separately gated deployment restart.
- **Three execution modes:** persistent online Go server, API Gateway/Lambda adapter, and offline/local Kubernetes agent.
- **Security controls:** Cognito ID-token validation for hosted use, local-only development auth, per-cluster agent credentials, CORS allowlist and approval gates for mutations.

## Architecture

```text
React + TypeScript dashboard
          |
          | authenticated HTTPS / local development API
          v
       Go HTTP API  <------> Airtable inventory adapter
          |
          +------> Monitoring summary + explainable analysis
          |
          +------> HMAC-signed Zapier notifications / commands
          |
          +<----- Go Kubernetes agent (outbound polling + telemetry)
          |
          +------> API Gateway / AWS Lambda adapter
```

| Runtime | Purpose | Current status |
|---|---|---|
| Online server | Go API, inventory, monitoring, analysis and command broker | Runnable locally; external hosting not configured |
| Online serverless | Shared Go API contract through AWS Lambda/API Gateway | Buildable; not deployed |
| Offline Kubernetes | Desktop or in-cluster Go agent using the selected kube context | Implemented; requires a running cluster and agent credentials |

## Run the submission demo (Windows)

Requirements: Go, Node.js 20+, pnpm 9+, and the repository dependencies installed.

From the repository root in PowerShell:

```powershell
pnpm install
powershell -ExecutionPolicy Bypass -File .\scripts\start-local-demo.ps1
```

The start script builds and launches the Go API and Vite dashboard, creates strong local-only credentials in ignored `.env.local` files, checks service health and opens the browser. It uses API port `8082` to avoid common local port conflicts.

- **Cluster Command:** http://localhost:5173/#/clusters
- **Monitoring:** http://localhost:5173/#/monitoring
- **AI Insights:** http://localhost:5173/#/ai-insights
- **API health:** http://127.0.0.1:8082/healthz

Stop the services started by the script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop-local-demo.ps1
```

See [the submission demo runbook](docs/submission/local-demo-runbook.md) for the evaluator walkthrough and verification boundaries.

## Demo walkthrough

1. Open **Cluster Command** and verify the 20 inventory records and execution-mode cards.
2. Review inventory provenance and telemetry freshness. The local profile uses a sanitized Airtable snapshot.
3. Open **Monitoring** to inspect reported cluster health, CPU/memory and node/pod counts.
4. Open **AI Insights** to review the initial findings, then run analysis again from the dashboard.
5. Show the integration boundaries: Zapier is disabled until a Catch Hook and signing secret are configured; the local Kubernetes agent reports offline until connected to a real cluster.

## Development and verification

Go backend:

```powershell
go test -race ./...
go vet ./...
go build ./cmd/cloudsentinels
go build ./cmd/cloudsentinels-agent
```

Frontend:

```powershell
pnpm --dir src/frontend typecheck
pnpm --dir src/frontend check
pnpm --dir src/frontend build
```

The GitHub Actions workflow also validates the Go API, agent, Lambda ARM64 build, Docker image builds and frontend checks.

## Key API routes

| Route | Purpose |
|---|---|
| `GET /healthz` / `GET /readyz` | Health and readiness |
| `GET /api/v1/platform` | Runtime and integration status |
| `GET /api/v1/inventory/clusters` | Sanitized cluster inventory |
| `POST /api/v1/inventory/refresh` | Refresh Airtable inventory when PAT is configured |
| `GET /api/v1/monitoring/summary` | Monitoring summary and agent telemetry |
| `GET /api/v1/ai/insights` / `POST /api/v1/ai/analyze` | Explainable cluster findings |
| `POST /api/v1/zapier/test` | Test configured Zapier Catch Hook |
| `POST /api/v1/zapier/commands` | HMAC-verified inbound automation command |
| `POST /api/v1/agent/telemetry` | Authenticated agent telemetry ingestion |

Protected routes require a valid bearer token. See [the integration guide](docs/integrations/airtable-zapier-desktop-agent.md) and [authentication setup](docs/architecture/authentication-setup.md).

## External configuration for live integrations

- **Airtable:** configure `AIRTABLE_API_TOKEN` on the Go server. Without it, the API serves the sanitized snapshot and disables refresh.
- **Cognito:** configure `COGNITO_ISSUER_URL` and `COGNITO_APP_CLIENT_ID` for hosted browser authentication. The local demo profile is development-only and restricted to localhost.
- **Zapier:** configure an HTTPS `ZAPIER_CATCH_HOOK_URL` and a strong `ZAPIER_SIGNING_SECRET`. The UI reports the integration as unavailable until configured.
- **Kubernetes:** start a reachable Kubernetes context and configure a unique `CLOUDSENTINELS_AGENT_TOKEN` (or per-cluster token map) for the Go agent and API.
- **AWS Lambda:** deploy the SAM template with an authorized AWS account and configure its secrets and runtime settings.

Never put server-side credentials in `VITE_*` variables or commit `.env.local` files.

## Important limitations and production gates

- The AI triage is an explainable rules engine, **not a trained ML model or LLM**.
- Airtable cluster CPU/memory values are inventory-reported values, not a streaming metrics feed.
- Current Airtable Nodes records are not linked to cluster rows and their Last Seen timestamps are historical; live telemetry requires an agent heartbeat.
- The online command queue and telemetry cache are in-memory. Production/multi-replica operation requires durable storage such as SQS/DynamoDB and persistent audit history.
- Zapier delivery and AWS Lambda have not been deployed from this branch; external credentials and account permissions are required.
- Mutating remediation is disabled by default and requires explicit approval, server and agent opt-in, and scoped Kubernetes RBAC.
- The legacy Motoko/Internet Computer modules remain in the repository; the current submission demo uses the Go API path described above.

CloudSentinels should only be described as production-ready after live integration, persistence, security and end-to-end deployment checks pass in the target environment.
