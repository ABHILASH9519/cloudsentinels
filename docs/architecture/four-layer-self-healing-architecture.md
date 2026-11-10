# CloudSentinels Four-Layer Self-Healing Architecture

## Purpose

CloudSentinels is a multi-cluster incident detection and remediation control plane for online Kubernetes, serverless Kubernetes workloads, and offline/local Kubernetes. The design separates cluster execution, secure connectivity, intelligence/orchestration, and automation execution.

## Four layers

### Layer 1 — Cluster / execution plane

Three supported cluster modes:

1. **Online Kubernetes with worker servers** — Amazon EKS with EC2 managed/self-managed node groups, plus other Kubernetes distributions through adapters. EKS owns the managed control plane; EC2 instances are worker nodes, not the EKS control plane.
2. **Online serverless Kubernetes workloads** — Amazon EKS with Fargate profiles. Fargate supplies pod compute; it does not remove the EKS control plane or Kubernetes API.
3. **Offline / local Kubernetes** — K3s, Kind, Minikube, or another local cluster operated through the CloudSentinels CLI and a local agent. Local policy and local remediation continue when disconnected; events are buffered and replayed after connectivity returns.

### Layer 2 — Connectivity, API, and identity

- CloudSentinels API: cluster registration, event ingestion, inventory, incident and action APIs.
- Online authentication gateway: Cognito JWT validation for user/API access, OIDC workload identity for CI/CD, and scoped RBAC.
- Cluster adapters: EKS/Kubernetes watch and metrics adapters for online clusters; local CLI/agent adapter for offline clusters.
- Device/agent credentials are short-lived and scoped. Never place kubeconfig files, bearer tokens, private keys, or onboarding secrets in Airtable or source control.

### Layer 3 — CloudSentinels intelligence and control

- **Incident detection:** consume Kubernetes watch events, node/pod health, metrics, logs, deployment changes, and local-agent events for every registered cluster.
- **AI analysis:** correlate signals, classify failure type, estimate blast radius, rank likely causes, and recommend a remediation. AI recommendations are not automatically trusted as executable shell commands.
- **Remediation orchestration:** resolve the event to a versioned procedure, evaluate policy and blast radius, enforce approval gates, deduplicate/idempotency keys, execute with bounded retries, and verify recovery.

### Layer 4 — Automation and procedure fabric

- EventBridge + SQS provide durable event delivery, retries, dead-letter queues, and decoupling.
- A **procedure registry** maps event signatures to versioned, tested runbooks. The automation coordinator resolves records from DynamoDB (`PK=SYSTEM#PROCEDURES`, `SK=PROCEDURE#<event-type>#<version>`) and falls back to built-in baseline rules. It is extensible rather than a finite list of hard-coded branches; the registry stores data, not executable scripts.
- Zapier handles external workflow integrations (notifications, tickets, approvals, status updates). Cluster mutations should execute through the controlled Kubernetes/AWS execution adapters, not by giving Zapier unrestricted kubeconfig access.
- Execution adapters apply the narrow action; verification checks health and closes or escalates the incident.
- Every run records input event, matched procedure/version, actor, policy decision, action, result, retry count, and audit trace.

## Event-to-remediation lifecycle

1. Adapter observes a health change or Kubernetes event.
2. API/agent authenticates and normalizes it into a common event envelope.
3. Detection correlates duplicate signals and opens/updates an incident.
4. AI analysis enriches the incident with classification and root-cause hypotheses.
5. Orchestrator resolves a procedure by event type, resource kind, labels, environment, and policy.
6. Policy engine decides auto-remediate, require approval, or observe-only.
7. Procedure runs through a least-privilege adapter with an idempotency key and bounded timeout/retries.
8. Health checks verify recovery; otherwise rollback/escalation and DLQ handling occur.
9. Incident and action history are persisted; optional Zapier workflows notify downstream systems.

### Example procedure catalogue

| Signal / failure | Candidate controlled procedure |
|---|---|
| Pod CrashLoopBackOff | Collect previous logs/events; inspect probes/config; restart only if policy permits; verify readiness |
| Pod Pending | Inspect scheduler events, quotas, PVCs, affinity and capacity; scale only through approved capacity policy |
| Deployment unavailable | Compare desired/available replicas; inspect rollout; pause or rollback only with policy/approval |
| Node NotReady / unreachable | Cordon, drain, replace or recover node only after disruption-budget and capacity checks |
| CPU / memory pressure | Identify top consumers; apply bounded scaling or resource recommendations |
| ImagePullBackOff | Validate image reference and registry access; never print credentials |
| PVC / storage failure | Inspect storage events and attachment state; no destructive volume operation without approval |
| API latency / error spike | Correlate service, ingress, dependency and saturation metrics; execute approved mitigation |
| Control-plane / cloud event | Route to provider-specific diagnostics and recovery runbook |
| Local cluster disconnected | Continue local safe procedures; buffer telemetry and replay when online |

The registry can grow with new event signatures and procedure versions. It must not create unbounded execution loops: each run has a deadline, retry budget, deduplication key, circuit breaker, and escalation path.

## Latency and safety objectives

- Design objective: trigger detection and dispatch quickly (seconds for streaming events); actual end-to-end time depends on telemetry interval, API availability, queue depth, cluster connectivity, and action duration. Do not promise a universal sub-second or fixed recovery time.
- Use local event handling for disconnected clusters; cloud orchestration cannot mutate a cluster it cannot reach.
- Use namespace/resource-scoped service accounts and short-lived credentials.
- Default to observe-only for unknown procedures and production-impacting actions.
- Require approval for destructive or high-blast-radius actions (delete PVC, drain/replace critical nodes, rollback production, change network/security policy).
- Bound retries, use circuit breakers, verify postconditions, and retain audit logs.
- Separate AI diagnosis from deterministic policy and execution.

## Airtable inventory integration

Airtable base: `Cloud-Sentinel`. Tables discovered: Kubernetes Clusters, Nodes, Pods, Deployments, Anomalies, Incidents, and Notifications. The repository already contains a sanitized showcase snapshot at `deploy/kubernetes/airtable-inventory-showcase.yaml` and instructions at `deploy/kubernetes/AIRTABLE-EKS-SHOWCASE.md`.

The cluster/node/pod/deployment tables are an **inventory/reference dataset**, not a Kubernetes deployment specification. Several records use example hostnames (`*.k8s.company.com`), example GitHub repositories, historical 2023/2024 timestamps, and a planned K3s record. They do not contain enough trusted information to recreate a real cluster or workload. Do not create EKS clusters, node groups, namespaces, Deployments, or Services directly from status/count fields.

Import only sanitized metadata (names, environment, status, resource counts, labels, namespace, desired replicas, repository reference) into the CloudSentinels inventory API or a non-secret ConfigMap. Exclude the `Kubeconfig` attachment and `Secure Onboarding Token` fields entirely. Never import credentials, tokens, private endpoints, or attachments into Kubernetes manifests.

### Initial inventory snapshot (read-only)

- 16 cluster records: includes a planned K3s record, inactive/offline records, and degraded/warning records.
- 15 node records.
- 15 pod records, including Pending and CrashLoopBackOff examples.
- 15 deployment records, including Pending and Failed examples.
- Data is suitable for a demo/test inventory and remediation simulation after validation, not for provisioning production infrastructure.

### Safe EKS onboarding sequence

1. Validate each Airtable record against a real cluster owner and live `kubectl get --raw /version`, `kubectl get nodes`, and workload inventory.
2. Register the real EKS cluster using a dedicated least-privilege role; do not reuse the root AWS identity.
3. Install the CloudSentinels adapter/controller with a scoped service account and approved namespace.
4. Sync sanitized inventory and compare it with live Kubernetes state; mark Airtable-only records as stale/unverified.
5. Generate manifests from reviewed source-of-truth workload specs (GitOps/Helm/Kustomize), not from Airtable status snapshots.
6. Start in observe-only mode, test synthetic failures in a non-production namespace, then enable explicitly approved runbooks.

## Current environment gate

The audited AWS account had no EKS clusters in the enabled regions. Therefore no Airtable records have been applied to EKS and no cluster was created. EKS provisioning and production mutations remain gated until a dedicated GitHub OIDC deployment role, environment approval, budget/region/cluster sizing, and a non-production target are configured.
