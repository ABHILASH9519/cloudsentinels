# Airtable → Kubernetes/EKS inventory onboarding

## Source

- Airtable base: `Cloud-Sentinel` (`app3xn3iXAsm7MgA7`)
- Tables: Kubernetes Clusters, Nodes, Pods, Deployments
- The source currently contains 16 cluster, 15 node, 15 pod, and 15 deployment records.

## Important: inventory is not a deployable cluster definition

The records provide labels, environment/status, node/pod counts, utilization snapshots, namespaces, replica counts, and repository references. They do not provide validated container images, ports, probes, resource requests/limits, service accounts, secrets, ingress rules, storage classes, network policies, autoscaling settings, or a trustworthy cluster endpoint/credential. Several values are clearly demo fixtures (example.com/company.com-style hostnames, example GitHub repositories, and historical timestamps).

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

- Safe Airtable inventory validator: `scripts/eks/validate-airtable-inventory.mjs`.
- Validator tests: `scripts/eks/validate-airtable-inventory.test.mjs`.
- Review-day EKS CloudFormation template: `deploy/eks/review-day-cluster.yaml`.
- Approval-gated manual workflow: `.github/workflows/eks-review-day.yml`.
- Non-provisioning CI validation: `.github/workflows/eks-inventory-validation.yml`.
- Operating instructions and OIDC requirements: `deploy/eks/README.md`.

The validator accepts an explicitly normalized, allowlisted JSON export and optional live-cluster snapshot. It rejects secret-bearing keys and emits only reconciliation labels/counts. Airtable inventory does not supply VPC/subnets, IAM role ARNs, EKS version, instance type, CIDR access, or workload manifests; those must be separately approved. The workflow's `plan` operation creates a change set only; `create` is protected by the `minor-review` environment and exact confirmation. The workflow file must reach the default branch before GitHub makes `workflow_dispatch` available.

## EKS status

No EKS clusters were present in the AWS account during the acceptance audit. This document does not provision EKS or modify any AWS/Kubernetes resource.
