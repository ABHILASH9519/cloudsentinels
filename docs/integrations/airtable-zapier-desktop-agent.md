# Airtable inventory, three-mode monitoring and Zapier / desktop CLI

## Data flow

```text
Airtable Cloud-Sentinel (sanitized cluster inventory)
       |
       v
Go inventory adapter ----> 20 cluster inventory records
       |                         |
       |                         +--> Online server (Go HTTP API)
       |                         +--> Online serverless contract (Lambda adapter still separate)
       |                         +--> Offline Kubernetes (desktop agent telemetry)
       |
       v
Explainable triage engine --> findings + evidence + recommended checks
       |
       +--> incident.created / local warning events --> Zapier Catch Hook
       |
Zapier Webhooks by Zapier --> signed POST /api/v1/zapier/commands
       |
       v
In-memory command queue --> desktop agent polling over outbound HTTPS
       |
       v
Fixed kubectl allowlist --> command result / local telemetry --> Go API
```

The three execution modes share one normalized inventory and analysis contract. Airtable records are not assumed to be assigned to a specific mode; each mode is a different execution adapter over the shared cluster inventory.

## Airtable

The Go API reads only these cluster fields: Cluster Name, Environment, Status, Node Count, Pod Count, CPU Usage (%), Memory Usage (MB), Health Status, Onboarding Date and Nodes. It reads only Cluster and Last Seen from the Nodes table. It deliberately does not fetch API Endpoint, onboarding tokens, kubeconfig or other secret fields.

- Base ID: `app3xn3iXAsm7MgA7`
- Cluster table: `tblkCeiGBpVuHgpvy`
- Node table: `tbliN9Rr6EcMsfwuk`
- Local fallback: `deploy/eks/airtable-inventory.snapshot.json`
- Server-side token: `AIRTABLE_API_TOKEN` (never a VITE_ variable)
- Sync interval: `AIRTABLE_SYNC_INTERVAL=5m`

Without an Airtable PAT, the service uses the sanitized checked-in snapshot. With a PAT, it fetches fresh inventory on startup and periodically. Airtable-reported CPU/memory are inventory values, not a streaming metrics source.

Current data-quality findings from the connected base:
- 20 cluster records.
- 15 Nodes records, but 0 Nodes records link to a cluster.
- Child node/pod/anomaly/incident timestamps are historical June 2024 data.
- Cluster rows have reported node/pod totals and CPU values, but those are not independently verified against live Kubernetes.
- Reported API endpoints are not used as connection targets.

For real metrics, register one authenticated desktop/cluster agent per target cluster.

## Three execution modes

| Mode | Current implementation | Readiness boundary |
|---|---|---|
| Online server | Go API, inventory, monitoring summary, analysis and webhook endpoints | Requires a reachable HTTPS deployment and Cognito config |
| Online serverless | Go API Gateway/Lambda adapter with shared inventory and analysis handlers | SAM template is buildable; deployment and secret configuration remain outstanding |
| Offline Kubernetes | Go desktop agent using kubectl with fixed command arguments | Requires local Docker Desktop/Minikube or another configured kube context |

The connected desktop currently has a Minikube kube context, but the Minikube Docker container and Docker Desktop Linux engine are stopped. The agent correctly refuses to report live telemetry until the API is reachable.

## Go API setup

Copy `.env.example` to a private environment file. Set a strong local auth token for local development or configure Cognito issuer + app client for production. Generate a dedicated agent token and Zapier signing secret independently:

```powershell
$env:CLOUDSENTINELS_LOCAL_AUTH_TOKEN = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:CLOUDSENTINELS_AGENT_TOKEN = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:ZAPIER_SIGNING_SECRET = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:CLOUDSENTINELS_ALLOWED_ORIGINS = "http://localhost:5173"
go run ./cmd/cloudsentinels
```

Useful authenticated endpoints:
- `GET /api/v1/inventory/clusters`
- `POST /api/v1/inventory/refresh`
- `GET /api/v1/monitoring/summary`
- `GET /api/v1/ai/insights`
- `GET /api/v1/automation/commands`
- `POST /api/v1/zapier/test`

The React app needs `VITE_CLOUDSENTINELS_API_URL` set to the Go API origin. The Go API validates Cognito ID tokens, not access tokens.

## Desktop CLI agent

Build a Windows executable:

```powershell
go build -trimpath -o cloudsentinels-agent.exe ./cmd/cloudsentinels-agent
$env:CLOUDSENTINELS_API_URL = "http://127.0.0.1:8080"
$env:CLOUDSENTINELS_AGENT_TOKEN = "<same dedicated agent token configured on the Go API>"
$env:CLOUDSENTINELS_AGENT_CLUSTER_ID = "minikube"
$env:CLOUDSENTINELS_AGENT_CONTEXT = "minikube"
$env:CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS = "false"
.\cloudsentinels-agent.exe
```

The agent collects node/ready-node counts, pod/ready-pod counts, warning event count, node CPU percentage and memory use using read-only kubectl calls. It polls only commands addressed to its configured cluster ID.

For multiple remote clusters, prefer unique agent tokens per Airtable record ID. Configure `CLOUDSENTINELS_AGENT_TOKENS` on the online server as a private JSON object, for example `{"recAirtableCluster1":"<32+ character token>","recAirtableCluster2":"<different 32+ character token>"}`. When this map is configured, only listed cluster IDs are accepted; the single `CLOUDSENTINELS_AGENT_TOKEN` fallback is disabled. Keep the desktop-only shared token only when no per-cluster map is configured.

### Deploy an in-cluster remote agent

Build and publish the agent image to your own registry:

```powershell
docker build -f deploy/agent/Dockerfile -t <your-registry>/cloudsentinels-agent:<version> .
docker push <your-registry>/cloudsentinels-agent:<version>
```

For each target cluster, create a unique secret and apply the read-only RBAC:

```powershell
kubectl create namespace cloudsentinels-system
kubectl -n cloudsentinels-system create secret generic cloudsentinels-agent-token --from-literal=token="<unique-cluster-token>"
kubectl apply -f deploy/agent/kubernetes/agent-readonly-rbac.yaml
```

Replace the image, HTTPS API URL, Airtable record ID and cluster name placeholders in `agent-deployment.yaml`, then apply it. Use the Airtable record ID as `CLOUDSENTINELS_AGENT_CLUSTER_ID` so live metrics merge into the matching Airtable row rather than creating a duplicate. Use one unique token per cluster in the server-side JSON token map.

The optional `agent-remediation-role.example.yaml` grants deployment patch only in the named namespace. Do not apply it unless restart remediation is explicitly approved for that namespace.

### CLI allowlist

- `collect-snapshot`: read-only node/pod/event and top metrics collection.
- `rollout-status`: read-only `kubectl rollout status` for a named deployment.
- `restart-deployment`: mutating `kubectl rollout restart` followed by `kubectl rollout status --timeout=60s`; reports success only after rollout verification. It requires a signed Zapier request with `approvalStatus=approved`, a non-empty `approvedBy`, server-side `CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS=true`, and local-agent `CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS=true`.

Arbitrary shell, PowerShell, scripts, delete, scale, exec, apply and credential export are not supported. Mutations are disabled by default. Do not enable them until the target namespace/deployment, approval policy, and rollback plan have been reviewed.

## Zapier connection

### GitHub Actions CI notification

The Go CI workflow calls `gpuliyar/zapier-webhook-action@v1.0.0` after both the Go and frontend jobs pass. Configure the repository Actions secret `ZAPIER_WEBHOOK_ID` with the ID segment from the Zapier Catch Hook URL (`https://hooks.zapier.com/hooks/catch/{webhook-id}`). Do not store the full URL in the workflow file. The notification contains the repository, branch, commit SHA, workflow name and run URL. The workflow notifies on successful push, pull-request and manual-dispatch checks. Manual dispatch is available after the workflow file is present on the repository default branch. Add the secret before expecting a live Zapier delivery. The requested action release declares the Node.js 16 runtime; GitHub may emit a deprecation warning or disable that runtime. Upgrade/fork it to a supported Node.js runtime before treating this notification path as production-critical.

This GitHub Actions notification is separate from the Go API's outbound application-event integration below, which requires `ZAPIER_CATCH_HOOK_URL` and `ZAPIER_SIGNING_SECRET`.

### Outbound notifications

1. Create a Zapier Catch Hook trigger.
2. Put its HTTPS URL in server-side `ZAPIER_CATCH_HOOK_URL`.
3. Configure `ZAPIER_SIGNING_SECRET` (32+ random characters).
4. CloudSentinels sends sanitized JSON with `X-CS-Timestamp`, `X-CS-Signature` (HMAC-SHA256 of timestamp + "." + exact request body) and `X-CS-Event-ID`.
5. In Zapier, route event types such as `incident.created`, `automation.command_queued` and `cloudsentinels.integration_test` to Slack, Teams, email or ticketing.

Do not forward kubeconfig, tokens, raw logs or unredacted secrets.

### Inbound CLI triggers

1. Add a Webhooks by Zapier action (POST) targeting `https://<your-api>/api/v1/zapier/commands`.
2. Build the exact JSON request body in a Code by Zapier step.
3. Compute HMAC-SHA256 over `timestamp + "." + exactBody` using the same secret; set `X-CS-Timestamp` and `X-CS-Signature`.
4. Use only the documented action names and target cluster ID.

Read-only example body:

```json
{"commandId":"zap-unique-event-id","action":"collect-snapshot","clusterId":"minikube"}
```

Approval-gated restart example (only after an explicit human approval step in the Zap):

```json
{"commandId":"zap-unique-event-id","action":"restart-deployment","clusterId":"minikube","namespace":"payments","deployment":"payments-api","approvalStatus":"approved","approvedBy":"approver@example.com"}
```

The server rejects restart requests unless the server mutation gate is enabled; the desktop agent also independently blocks them unless its local mutation gate is enabled. Zapier does not receive a shell endpoint or direct access to Desktop Commander.

## Data and operational limitations

- The command queue and local telemetry cache in this Go bootstrap are in-memory. A restart loses queued commands and recent telemetry. Production serverless/multi-replica deployment must move this to the existing AWS SQS/DynamoDB persistence layer before relying on it.
- The current AI analysis is an explainable threshold/rules engine, not a trained LLM/ML model. It provides evidence and recommended checks only; it never authorizes remediation.
- The connected desktop currently has no active Docker Desktop Linux engine; Minikube is stopped.
- Airtable live API refresh requires a server-side PAT that is not configured in this desktop session.
- The online-serverless Go adapter and live Zapier Catch Hook have not been deployed/configured by this code change.
