# AWS EKS showcase mapping

This is a planning guide for a short CloudSentinels showcase in ap-south-1 (Mumbai). It does not create AWS resources.

## Source inventory

The sanitized Airtable export is at [sample-data/airtable-kubernetes-inventory.json](../../sample-data/airtable-kubernetes-inventory.json). It contains the full logical sample inventory from the Cloud-Sentinel base:

- 16 cluster records (including the CloudSentinels planned placeholder)
- 15 node records
- 15 pod records
- 15 anomaly records
- 15 incident records
- 15 notification records
- 15 deployment records

Credential-bearing Airtable fields are intentionally omitted: Secure Onboarding Token and Kubeconfig attachments. The records are synthetic/sample operational data; API endpoint strings and linked objects are not proof of reachable infrastructure.

## Mapping to AWS resource concepts

| Airtable sample | AWS / Kubernetes showcase concept |
|---|---|
| Kubernetes Clusters | Logical cluster inventory; choose one as the showcase EKS cluster |
| Nodes | EC2 worker-node inventory and Kubernetes Node objects |
| Pods | Kubernetes Pod / Deployment workload examples |
| Incidents and Anomalies | CloudSentinels incident and alert examples |
| Deployments | Kubernetes Deployment / rollout examples |
| Notifications | Incident notification audit examples |
| Node disk usage | Input for illustrative EBS sizing only; not an actual EBS volume |

The awsShowcaseBlueprint section in the JSON defines one illustrative EKS cluster, two illustrative EC2 workers, and two illustrative gp3 EBS volumes. These are sample records only. Do not launch one EKS cluster for every Airtable cluster row or one EC2 instance for every sample node.

## Budget guardrail

The previously approved ceiling was under USD 50/month. An EKS cluster's standard-support control plane alone is approximately USD 0.10 per cluster-hour, about USD 73 for 730 hours, before EC2, EBS, public IPv4, networking, and other charges. Therefore this blueprint is not approval to provision EKS under the original monthly budget. Use K3s on a single EC2 instance for a recurring low-cost test environment, or obtain a revised budget and explicitly approve a short-lived EKS test before provisioning.

## Live application integration status

The current CloudSentinels backend README describes incident, alert, and metric records, but does not describe native cluster, node, pod, deployment, EBS, or EKS resource tables. The export is committed as a sanitized fixture; it is not yet imported into a deployed canister and does not establish live telemetry.

To make the complete relational inventory visible in the live app, implement backend entities and authenticated import methods for clusters, nodes, pods, anomalies, notifications, deployments, plus an import-source marker and idempotency key. Then extend the frontend to render these entities and wire a telemetry adapter. Until that work is complete, only the existing incident/metric/alert demo import path is supported.

## Security

- Never export Airtable Secure Onboarding Token or Kubeconfig attachments.
- Never store kubeconfig, AWS access keys, or private credentials in Git.
- Use an IAM role / instance profile with least privilege.
- Keep Kubernetes API, Prometheus, and Grafana private; use SSM or a protected access path.
- Label every fixture record as sample data and keep it separate from live telemetry.