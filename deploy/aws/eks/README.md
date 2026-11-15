# Airtable inventory and EKS deployment

## Authoritative cluster inventory

CloudSentinels uses the sanitized Airtable snapshot at `deploy/eks/airtable-inventory.snapshot.json`, refreshed from the connected Cloud-Sentinel Airtable base. The Go API reads the same 20 cluster records by Airtable record ID. The local Kubernetes inventory service mounts this exact snapshot; EKS will mount the same artifact during the real cluster deployment.

The separate legacy `sample-data/airtable-kubernetes-inventory.json` fixture has been retired. Do not use synthetic topology records or API endpoint fields as a source of truth for infrastructure provisioning.

## Data boundaries

The current Airtable base contains 20 cluster rows and related child records. Child-table links and Last Seen timestamps are not sufficient to infer live Kubernetes state. The Go agent is the source of real node, pod, warning-event and resource telemetry. Inventory-reported CPU/memory remains labelled as Airtable metadata until replaced by a live agent heartbeat.

The inventory exporter uses a field allowlist and excludes credentials, kubeconfig attachments, onboarding tokens and endpoint secrets. EKS manifests and infrastructure sizing must be reviewed independently; Airtable row counts are not provisioning instructions.

## EKS deployment

Use the protected, manual GitHub Actions workflow `.github/workflows/eks-review-day.yml` to plan, review and execute the real EKS stack in `ap-south-1`. The plan and execute operations are separate; require the approved owner, budget, VPC/subnets, EKS version, node type/count, endpoint allowlist, IAM roles and teardown/retention plan before execution.

After the cluster is available:

1. Apply the Go agent read-only RBAC from `deploy/agent/kubernetes/agent-readonly-rbac.yaml`.
2. Create a unique agent token for each Airtable cluster record ID and store it in Secrets Manager / Kubernetes Secret.
3. Deploy the Go agent image from `deploy/agent/Dockerfile` with the HTTPS Go API URL and the Airtable record ID as `CLOUDSENTINELS_AGENT_CLUSTER_ID`.
4. Verify real telemetry and ensure it merges into the matching Airtable inventory row.
5. Verify the local Docker-backed Kubernetes cluster and EKS cluster appear separately in CloudSentinels with accurate telemetry freshness.

Never turn Airtable pod/deployment rows into live Kubernetes resources without separately reviewed manifests, immutable images, resource requests, probes, service accounts, RBAC and network policy.
