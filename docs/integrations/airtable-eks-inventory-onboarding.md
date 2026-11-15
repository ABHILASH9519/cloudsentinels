# Airtable → Kubernetes/EKS inventory onboarding

## Source

- Airtable base: `Cloud-Sentinel` (`app3xn3iXAsm7MgA7`)
- Tables: Kubernetes Clusters, Nodes, Pods, Deployments
- The latest checked snapshot contains 20 Kubernetes Clusters records, 15 Nodes, 15 Pods, 15 Deployments, 15 Anomalies, and 15 Incidents. The 20 cluster rows were created in Airtable on 2026-11-10. The child-table records were created on 2026-05-13 and contain historical June 2024 telemetry/events.

## Important: inventory is not a deployable cluster definition

The records provide labels, environment/status, node/pod counts, utilization snapshots, namespaces, replica counts, and repository references. They do not provide validated container images, ports, probes, resource requests/limits, service accounts, secrets, ingress rules, storage classes, network policies, autoscaling settings, or a trustworthy cluster endpoint/credential. Some fields contain placeholder-like hostnames and repository references, and child-table timestamps are historical; validate them with the cluster owner and live Kubernetes API before using them operationally.

Consequently this importer is **inventory-only**. It must not create EKS clusters or deploy workloads from the records. Workload manifests must come from the real application repositories and reviewed Helm/Kustomize sources.

## Field mapping

| Airtable | CloudSentinels inventory field | Kubernetes/EKS use |
|---|---|---|
| Cluster Name | cluster.name | Cluster registration label only |
| Environment | cluster.environment | label / policy context |
| Status, Health Status | cluster.reportedStatus / reportedHealth | Observed metadata; reconcile against live state |
| API Endpoint | cluster.reportedEndpoint | Untrusted hint until validated by cluster owner |
| Node Count, Pod Count | inventory counts | Compare with live API; never provision from counts |
| Node Name, Status, CPU, Memory, Disk | node inventory | Compare with live Node status/metrics |
| Pod Name, Namespace, Status, Restart Count | pod inventory | Compare with live Pod status/events |
| Deployment Name, Namespace, Replicas, Status, Repository URL | workload inventory | Generate a review task; source specs from Git/Helm |

## Mandatory exclusions

Do not read, export, log, or copy these fields into generated artifacts:
- Kubernetes Clusters → Kubeconfig
- Kubernetes Clusters → Secure Onboarding Token

Do not export Airtable attachment URLs, API credentials, environment secrets, tokens, or private keys.

## Reconciliation workflow

1. Export only the allowlisted fields above.
2. Validate record age, owner, environment, and cluster identity.
3. Compare with live EKS/Kubernetes API through a read-only scoped identity.
4. Emit a diff: `MATCH`, `SOURCE_ONLY`, `CLUSTER_ONLY`, `DRIFT`, `STALE`.
5. Require explicit review before changing Kubernetes resources.
6. Apply only reviewed GitOps manifests with the dedicated OIDC deployment role.
7. Reconcile and record post-apply health.

## Review-day implementation assets

- Direct Airtable read-only exporter: `scripts/eks/fetch-airtable-inventory.mjs` (requires protected environment secret `AIRTABLE_API_TOKEN`).
- Safe Airtable inventory validator: `scripts/eks/validate-airtable-inventory.mjs`.
- Validator tests: `scripts/eks/validate-airtable-inventory.test.mjs`.
- Review-day EKS CloudFormation template: `deploy/eks/review-day-cluster.yaml`.
- Approval-gated manual workflow: `.github/workflows/eks-review-day.yml`.
- Non-provisioning CI validation: `.github/workflows/eks-inventory-validation.yml`.
- Operating instructions and OIDC requirements: `deploy/eks/README.md`.

The exporter reads allowlisted cluster health/utilization fields plus linked Nodes and Last Seen metadata, derives latest node activity per cluster, and omits kubeconfig/token/attachment fields entirely. It now records Airtable `createdTime` separately as `recordCreatedAt`. A recent record import is not evidence of fresh runtime telemetry: `lastSeenAt` remains a separate signal. The validator accepts that normalized JSON export and optional live-cluster snapshot. It rejects secret-bearing keys and emits only reconciliation labels/counts. Airtable inventory does not supply VPC/subnets, IAM role ARNs, EKS version, instance type, CIDR access, or workload manifests; those must be separately approved. The workflow's `plan` and `execute` operations require a recent cluster inventory import (90-day threshold on Airtable `createdTime`) and separately report stale/missing node telemetry. `plan` creates a change set only; a separate `execute` operation rechecks the named change set, requires a second protected-environment approval, and requires exact confirmation before execution. The workflow file must reach the default branch before GitHub makes `workflow_dispatch` available.

## Current data freshness assessment (2026-11-10)

The live Airtable query on 2026-11-10 returned 20 cluster records, all created at 2026-11-10T15:36:15Z. It also returned 15 Nodes, 15 Pods, 15 Deployments, 15 Anomalies, and 15 Incidents. All 15 Nodes have `Last Seen` timestamps from 7–10 June 2024; none of the 20 cluster rows links to a Node, and none of the 15 Node rows links back to a Cluster. Deployment rows also have no Cluster links. The cluster inventory import is recent, so the review-day plan gate can proceed, but node/pod/deployment/anomaly/incident telemetry is historical and cannot be treated as current state. The checked-in sanitized snapshot is `deploy/eks/airtable-inventory.snapshot.json`; its controlled scenario matrix is `deploy/eks/review-day-scenarios.json`. `prod-ap-south-04` is the Mumbai-region production inventory reference (Active/Healthy, reported 58% CPU, 9 nodes, 240 pods), not a validated EKS target or deployable workload source. `staging-03` is reported Critical at 91% CPU; `qa-02` and `prod-eu-west-03` are reported Warning/Degraded. Retired `legacy-dr-01` and Inactive `dev-03` are excluded from active baseline scenarios. Reported endpoints are unverified company.com-style hints.

## EKS status

No EKS clusters were present in the AWS account during the acceptance audit. This document does not provision EKS or modify any AWS/Kubernetes resource.
