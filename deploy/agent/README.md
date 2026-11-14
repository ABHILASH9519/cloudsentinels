# CloudSentinels cluster agent

The Go agent collects Kubernetes node/pod/deployment health, warning events and available CPU/memory metrics. It reports telemetry to the Go API and forwards individual cluster signals through the authenticated agent-event endpoint. The Go API signs and dispatches normalized events to the single local n8n workflow.

## Local Windows host mode

Use the host mode when the Kubernetes API is local to the developer workstation and the Go API is listening on loopback.

~~~powershell
.\deploy\agent\local\start-agent.ps1 -ClusterId cloudsentinels-local -Context cloudsentinels-local -ApiUrl http://127.0.0.1:8082 -AllowedNamespaces cloudsentinels-system -EnableApprovedRemediation
~~~

The script:

- Loads the existing agent bearer token from the repository .env.local without printing it.
- Builds the Go agent.
- Creates a context-scoped kubeconfig copy under %LOCALAPPDATA%\CloudSentinels\agents and restricts its file ACL to the current user and SYSTEM.
- Runs the agent as a background process with a 30-second collection interval.
- Enables only the existing approved-remediation code path when the switch is supplied.
- Restricts mutating commands to the configured namespace allowlist (default: cloudsentinels-system).

Stop the agent and remove its context-scoped kubeconfig:

~~~powershell
.\deploy\agent\local\stop-agent.ps1 -ClusterId cloudsentinels-local
~~~

### Attach both local Kubernetes clusters to the same n8n workflow

The standalone local Minikube context is `cloudsentinels-local`. Docker Desktop Kubernetes is a separate cluster and appears as `docker-desktop` only after it is created in Docker Desktop.

1. In Docker Desktop, open **Kubernetes** and select **Create cluster**. Wait until `docker desktop kubernetes status` reports `State: enabled` and `kubectl config get-contexts` includes `docker-desktop`.
2. Run this helper to start/restart the per-cluster Go agents:

~~~powershell
.\deploy\agent\local\attach-local-clusters.ps1 -IncludeDockerDesktop
~~~

Both agents send telemetry and normalized cluster events to the same Go API and the same local n8n unified workflow. If Docker Desktop Kubernetes has not been created yet, the helper keeps the Minikube agent attached and reports the missing Docker context without failing the Minikube path.

The local host process uses the selected user's kubeconfig identity for Kubernetes API access. Do not run this mode with an untrusted kubeconfig. Mutation actions remain restricted by the fixed action allowlist, signed human approval and namespace allowlist. For production clusters, prefer the in-cluster Deployment and dedicated ServiceAccount/RBAC manifests below.

## In-cluster mode

- agent-deployment.yaml is a deployment template; replace the image, API URL, cluster ID and token secret reference before applying.
- agent-readonly-rbac.yaml grants cluster-wide read-only access to nodes, pods, events, deployments, ReplicaSets and metrics.
- agent-remediation-role-local.yaml is a sample namespace-scoped Role/RoleBinding for deployment get/patch inside cloudsentinels-system only.
- Mutations are disabled in the Deployment template by default. Keep them disabled until the command approval and namespace policy have been reviewed.

The local Minikube cluster currently has the read-only ClusterRole/ClusterRoleBinding and the cloudsentinels-system scoped Role/RoleBinding applied. The active host agent currently uses its context-scoped kubeconfig; the in-cluster Deployment remains a template and is not deployed.

## Agent event API

- POST /api/v1/agent/telemetry — authenticated cluster snapshot.
- POST /api/v1/agent/events — authenticated, bounded cluster signal with event ID, severity, resource kind/name, namespace and timestamp.
- GET /api/v1/agent/commands?clusterId=<id> — retrieve commands for the authenticated cluster.
- Command results are reported to the Go API; only restart-deployment and rollback-deployment are mutating actions in the current agent allowlist.
