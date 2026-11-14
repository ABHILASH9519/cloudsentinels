# CloudSentinels

**A Go-first cloud and Kubernetes observability platform with a React dashboard, explainable incident triage and approval-gated response workflows.**

Go owns the cluster inventory/monitoring API, explainable cluster analysis, Kubernetes agent and a standalone Lambda adapter. The React/TypeScript frontend is the presentation layer. The currently deployed AWS Operations Lambda still serves persistent incident/alert/profile routes, and supporting EventBridge/SQS/Zapier workers remain Node.js; porting those deployed handlers into Go is a remaining migration task.

> **Latest local verification (15 Nov 2026; AWS runtime last verified 15 Nov):** local n8n is running with the unified multi-cluster workflow published. The Minikube profile cloudsentinels-local is running; its Go agent reports 1/1 Ready node and 9/9 healthy pods to the Go API on port 8082. The agent forwards authenticated cluster events into the unified n8n workflow. Deployment restart/rollback is approval-gated and restricted by an agent namespace allowlist. Docker Desktop's built-in Kubernetes is disabled and the separate minikube context is unreachable. The AWS Lambda functions are active in ap-south-1, while the CloudSentinel EC2 server in eu-north-1 is stopped. AWS EventBridge/SQS bridge stacks are deployed in ap-south-1 and eu-north-1, including Lambda and EC2 monitoring alarms; a synthetic event reached the dedicated SQS queue. The local SQS poller is pending AWS CLI SSO authentication. EKS is not provisioned.

## Features

- **Cluster inventory:** 20 sanitized cluster records loaded from the checked-in Airtable snapshot; optional server-side Airtable API refresh.
- **Monitoring:** normalized cluster health, node/pod counts, reported CPU/memory and agent telemetry freshness.
- **Explainable AI triage:** deterministic rules inspect cluster health, CPU, state and missing telemetry; findings include evidence, confidence and recommended checks.
- **Kubernetes agent:** Go desktop/in-cluster agent collects node, pod, warning-event and resource metrics; approved deployment restart/rollback is restricted by the agent action and namespace allowlists.
- **Unified automation:** one local n8n workflow classifies Kubernetes, EC2, Lambda and supported security events into the same incident lifecycle and remediation runbook. HMAC-signed Go API events and Zapier notifications remain separate destinations.
- **Three execution modes:** persistent online Go server, a Go API Gateway/Lambda adapter (built, not yet the active deployed Operations API), and offline/local Kubernetes agent.
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
          +------> Signed event dispatch to local n8n workflow

AWS EventBridge / SQS --> local poller --> same n8n workflow
```

| Runtime | Purpose | Current status |
|---|---|---|
| Online server | Go API, inventory, monitoring, analysis and command broker | Running locally; standalone EC2 host not provisioned |
| Online serverless | AWS API Gateway HTTP API, Lambda, DynamoDB, EventBridge and SQS | Deployed in ap-south-1; health route verified |
| Offline/local Kubernetes | Minikube profile cloudsentinels-local plus Go agent | Running; 1 Ready node, 9/9 healthy pods; approval-gated actions limited to cloudsentinels-system |
| Local automation | Docker n8n + unified workflow | Running and tested with synthetic Kubernetes, EC2, Lambda, GuardDuty and DLQ events |
| Docker Desktop Kubernetes | Built-in Docker Desktop cluster | Disabled; enable in Docker Desktop Settings → Kubernetes before attaching its agent |
| AWS → local n8n bridge | EventBridge → dedicated SQS → local poller | AWS stacks deployed; synthetic queue delivery verified; local poller pending AWS CLI SSO login |

## Run the local operational stack (Windows)

Requirements: Go, Node.js 20+, pnpm 9+, and the repository dependencies installed.

From the repository root in PowerShell:

```powershell
pnpm install
powershell -ExecutionPolicy Bypass -File .\scripts\start-local-server.ps1
```

The startup script configures the deployed Amazon Cognito user pool and AWS Lambda API, builds the Go API and Vite dashboard, and launches the local services. Sign-in and self-registration use real Cognito accounts; no local mock identity or sample-record importer is enabled. The Go API uses Cognito JWT validation and runs on port `8082`.

Start the real Docker-backed Kubernetes cluster, mount the Airtable inventory and connect the read-only agent:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\kubernetes\start-local-cluster.ps1
```

This mounts all 20 Airtable cluster records in a Kubernetes ConfigMap and sends actual local node/pod telemetry to the Go API. The source inventory and live telemetry remain separate.

- **Cluster Command:** http://localhost:5173/#/clusters
- **Monitoring:** http://localhost:5173/#/monitoring
- **AI Insights:** http://localhost:5173/#/ai-insights
- **API health:** http://127.0.0.1:8082/healthz

Stop the services started by the script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop-local-server.ps1
```

See [the real-environment operations runbook](docs/operations/real-environment-runbook.md) for local Kubernetes setup and acceptance checks, [the unified automation runbook](deploy/automation/README.md) for the single n8n workflow and AWS bridge, and [the cluster agent runbook](deploy/agent/README.md) for local/in-cluster agent setup.

## Operational verification

1. Run `kubectl --context cloudsentinels-local get nodes -o wide` and confirm the node is Ready.
2. Run `kubectl --context cloudsentinels-local get pods -n cloudsentinels-system` and confirm the Airtable inventory service is Running.
3. Read the in-cluster inventory at `http://airtable-inventory.cloudsentinels-system.svc.cluster.local/inventory/inventory.json`; it contains the exact 20-row Airtable snapshot.
4. Open **Monitoring** and verify the `cloudsentinels-local` agent heartbeat, real node/pod counts and collection timestamp.
5. Open **AI Insights** and review explainable findings. Airtable-reported metrics must remain labelled as inventory data, not live telemetry.

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

The GitHub Actions workflows validate the Go API, agent, Go Lambda ARM64 build, Docker images and React frontend. After successful Go and UI checks on a push (or manual workflow dispatch), the `zapier-notify` job sends a CI event to Zapier when the repository secret `ZAPIER_WEBHOOK_ID` is configured.

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
| `POST /api/v1/agent/events` | Authenticated per-resource Kubernetes signals forwarded to n8n |

Protected routes require a valid bearer token. See [the integration guide](docs/integrations/airtable-zapier-desktop-agent.md) and [authentication setup](docs/architecture/authentication-setup.md).

## External configuration for live integrations

- **Airtable:** configure `AIRTABLE_API_TOKEN` on the Go server. Without it, the API serves the sanitized snapshot and disables refresh.
- **Cognito:** configure `COGNITO_ISSUER_URL` and `COGNITO_APP_CLIENT_ID` for hosted browser authentication. The local frontend uses the same Cognito user pool as the hosted runtime; the Go API validates Cognito ID tokens.
- **Zapier application events:** configure an HTTPS `ZAPIER_CATCH_HOOK_URL` and a strong `ZAPIER_SIGNING_SECRET` on the Go API. The UI reports the integration as unavailable until configured.
- **Zapier GitHub Actions notifications:** add the Catch Hook ID (the path after `/hooks/catch/`, not the full URL) as the repository Actions secret `ZAPIER_WEBHOOK_ID`. The workflow posts a sanitized build result only after both Go and frontend jobs pass. The secret is optional; notifications are skipped when it is absent.
- **Kubernetes:** start a reachable Kubernetes context and configure a unique `CLOUDSENTINELS_AGENT_TOKEN` (or per-cluster token map) for the Go agent and API.
- **AWS Lambda:** the API Gateway/Node.js Operations runtime is deployed in ap-south-1. The separate Go Lambda adapter cross-builds successfully but is not yet deployed as the active Operations API. The HMAC-signed cluster telemetry route still requires a registered cluster secret before it can accept events.

Never put server-side credentials in `VITE_*` variables or commit `.env.local` files.

## Important limitations and production gates

- The AI triage is an explainable rules engine, **not a trained ML model or LLM**.
- Airtable cluster CPU/memory values are inventory-reported values, not a streaming metrics feed.
- Current Airtable Nodes records are not linked to cluster rows and their Last Seen timestamps are historical; live telemetry requires an agent heartbeat.
- The online command queue and telemetry cache are in-memory. Production/multi-replica operation requires durable storage such as SQS/DynamoDB and persistent audit history.
- Zapier delivery remains disabled until the real Catch Hook and signing secret are configured. AWS Lambda/API Gateway is deployed; EKS-to-Lambda telemetry still requires a cluster signing secret and owner mapping.
- Mutating remediation is disabled by default and requires explicit approval, server and agent opt-in, and scoped Kubernetes RBAC.
- The legacy Motoko/Internet Computer backend, generated actor bindings, Internet Identity flow and SDK dependencies have been removed from the active project. The frontend remains React/TypeScript; the cluster API and Kubernetes agent are Go. The deployed AWS Operations Lambda and event-relay/automation workers remain Node.js pending their separate Go migration.

CloudSentinels should only be described as production-ready after live integration, persistence, security and end-to-end deployment checks pass in the target environment.
