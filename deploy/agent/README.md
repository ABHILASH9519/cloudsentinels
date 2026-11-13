# CloudSentinels desktop Kubernetes agent

The Go agent is intended to run on the operator's desktop or a trusted cluster-adjacent host. It makes outbound HTTPS calls to the Go API and executes a small fixed kubectl allowlist.

## Build (Windows)

```powershell
go build -trimpath -o cloudsentinels-agent.exe ./cmd/cloudsentinels-agent
```

Set `CLOUDSENTINELS_API_URL`, `CLOUDSENTINELS_AGENT_TOKEN` (same dedicated token configured on the Go API), and `CLOUDSENTINELS_AGENT_CLUSTER_ID`. The default cluster ID is `minikube`. Set `CLOUDSENTINELS_AGENT_CONTEXT` if the current kubectl context should not be used. For multiple remote clusters, configure a private `CLOUDSENTINELS_AGENT_TOKENS` JSON map on the API keyed by Airtable record ID; each cluster agent must have its own unique token, and only IDs in that map are accepted.

Run with `CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS=false`. It collects node/pod/event data and top metrics every 30 seconds and polls only commands for its cluster ID.

## Safety

- No arbitrary shell or command string is accepted.
- `collect-snapshot` and `rollout-status` are read-only.
- `restart-deployment` requires signed webhook approval plus server and local mutation flags explicitly enabled.
- No delete, scale, exec, apply, credential export or arbitrary scripts are supported.
- Use a least-privilege kubeconfig/RBAC identity. Do not use a cluster-admin context for routine monitoring.

An in-cluster deployment template and read-only RBAC are in `kubernetes/`. Build the container with `Dockerfile`, publish it to your registry, create the `cloudsentinels-agent-token` Secret, replace the manifest placeholders, and apply `agent-readonly-rbac.yaml` plus `agent-deployment.yaml`. Use the Airtable record ID as the agent cluster ID so telemetry merges into the matching inventory row.

The API command queue and telemetry cache are currently process-local. For production multi-replica use, move command delivery and telemetry history to durable SQS/DynamoDB storage and enable persistent audit records before relying on the API for operational response.
