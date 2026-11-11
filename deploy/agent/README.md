# CloudSentinels cluster telemetry agent

The agent is a **read-only Kubernetes event collector**. It polls Warning events, classifies a small allowlist of operational signals, and submits signed telemetry to the CloudSentinels API. It does not run kubectl apply/delete/scale, change workloads, or execute remediation.

## Supported signals

| Kubernetes signal | CloudSentinels event | Default severity |
|---|---|---|
| Pod restart back-off / CrashLoopBackOff | `PodCrashLoopBackOff` | high |
| NodeNotReady | `NodeNotReady` | critical |
| OOMKilled / Evicted / MemoryPressure | `MemoryPressure` | high |
| Unhealthy / FailedScheduling / FailedCreate | `DeploymentUnhealthy` | medium |

CPU and API-latency event types are reserved for a future metrics collector; this agent does not fabricate them from Kubernetes Events.

## Configure the API

Create a Secrets Manager secret in `ap-south-1` with a JSON object keyed by cluster ID:

```json
{
  "demo-cluster": {
    "ownerId": "<Cognito user sub>",
    "clusterName": "demo-cluster",
    "signingSecret": "<at least 32 random characters>"
  }
}
```

Generate the signing secret locally with `openssl rand -hex 32`. Do not commit the secret or put it in GitHub source. Set the runtime CloudFormation parameter `ClusterAgentSecretArn` to the resulting secret ARN. The Operations Lambda receives only `secretsmanager:GetSecretValue` for that secret.

The public `POST /telemetry/events` route does not accept Cognito credentials. It requires:
- `x-cs-cluster-id`
- `x-cs-timestamp` (Unix seconds, maximum five-minute clock skew)
- `x-cs-signature` (HMAC-SHA256 over `timestamp + "." + cluster ID + "." + exact request body`)

A valid event creates an owner-scoped active alert and publishes a domain event for the automation processor. Duplicate event IDs are idempotently acknowledged. The DynamoDB idempotency marker expires after 30 days via the table TTL setting.

## Run locally

Requirements: Python 3.10+, `kubectl`, a working kubeconfig with permission to list Warning events, and a registered cluster secret.

```bash
export CLOUDSENTINELS_API_URL="https://<api-id>.execute-api.ap-south-1.amazonaws.com/v1"
export CLOUDSENTINELS_CLUSTER_ID="demo-cluster"
export CLOUDSENTINELS_SIGNING_SECRET="<secret-from-secrets-manager>"
python3 deploy/agent/cluster_agent.py --once
python3 deploy/agent/cluster_agent.py
```

The collector polls every 30 seconds by default. It keeps a SQLite retry spool locally and remembers acknowledged event IDs for 30 days. Set `POLL_INTERVAL_SECONDS` or use `--poll-interval` to change the interval. Use `--spool` to choose the local database path.

Run its unit tests with:

```bash
python3 -m unittest discover -s deploy/agent -p 'test_*.py'
```

## Container / Kubernetes preparation

Build the container from this directory:

```bash
docker build -t cloudsentinels-agent:local deploy/agent
```

The template `cluster-agent-deployment.template.yaml` contains a read-only ClusterRole limited to listing and watching Kubernetes Events. It is a deployment template only; **do not apply it to EKS before the review**. Create the Kubernetes Secret `cloudsentinels-agent-credentials` out-of-band with keys `api-url`, `cluster-id`, and `signing-secret`, render `${IMAGE_REF}` with your registry image, and review the namespace, RBAC, image, and resource limits before applying.

The local collector and its tests can be built without creating an EKS cluster or deploying any Kubernetes workload.
