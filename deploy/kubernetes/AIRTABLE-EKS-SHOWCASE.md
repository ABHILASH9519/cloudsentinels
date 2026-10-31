# Airtable inventory on EKS (evaluation showcase)

This manifest publishes the sanitized Airtable inventory inside a real Kubernetes namespace and persists a copy on an AWS EBS gp3 volume.

## What is included

- Namespace: `cloudsentinels-showcase`
- ConfigMap: `airtable-inventory-source` (source fixture)
- StorageClass: `cloudsentinels-gp3` (EBS CSI, encrypted gp3)
- PVC: `airtable-inventory-ebs` (4 GiB)
- Deployment: `airtable-inventory` (init container copies the fixture to EBS; NGINX serves it)
- Service: `airtable-inventory` (ClusterIP)

The source dataset contains 16 cluster records and 15 each of nodes, pods, anomalies, incidents, notifications and deployments (106 records total). It preserves sample record IDs and relationship labels. Notification recipients and message bodies are redacted in this Kubernetes copy. Kubeconfig and onboarding-token fields are excluded.

**Important:** Airtable rows are sample inventory, not AWS resource instructions. This creates one showcase namespace and one EBS-backed data volume. It does not create 16 EKS clusters, 15 EC2 nodes, or 15 live Kubernetes pods from historical records. The JSON is sample inventory, not live telemetry.

## Prerequisites

1. A healthy EKS cluster with at least one Ready EC2 worker node in `ap-south-1`.
2. EBS CSI driver installed as an EKS add-on, with its service account/Pod Identity role authorized for EBS volume operations.
3. Cluster access configured for the deploying IAM principal.
4. Worker nodes in an Availability Zone where the EBS volume can be attached.

Do not apply the manifest until the EBS CSI driver is Ready. EBS volumes are AZ-scoped and a PVC may remain Pending if the cluster has no schedulable worker capacity.

## Apply and verify

From a workstation with AWS CLI v2 and kubectl configured for the target cluster:

```bash
aws eks update-kubeconfig --region ap-south-1 --name cloudsentinels-eval
kubectl apply -f deploy/kubernetes/airtable-inventory-showcase.yaml
kubectl -n cloudsentinels-showcase rollout status deployment/airtable-inventory --timeout=5m
kubectl -n cloudsentinels-showcase get pods,pvc,svc
kubectl -n cloudsentinels-showcase get pv
```

Read the sample inventory:

```bash
kubectl -n cloudsentinels-showcase port-forward svc/airtable-inventory 8080:80
# In another terminal:
curl http://127.0.0.1:8080/inventory/inventory.json
```

The JSON is also stored on the EBS-backed PVC at `/inventory/inventory.json` inside the NGINX container.

## Teardown (after the evaluation)

The PVC uses a StorageClass with `reclaimPolicy: Delete`. Remove the namespace to delete its PVC and dynamically provisioned EBS volume after the workload is no longer needed:

```bash
kubectl delete namespace cloudsentinels-showcase
kubectl get pvc,pv -A
aws ec2 describe-volumes --region ap-south-1 --filters Name=tag:kubernetes.io/created-for/pvc/namespace,Values=cloudsentinels-showcase
```

Verify there are no remaining EBS volumes, snapshots, load balancers or other resources before considering the showcase fully torn down. Deleting this namespace does not delete the EKS control plane or node group; delete those separately when finished.

## Status

This file is a deployment artifact committed to the repository. It has **not** been applied to a live EKS cluster yet. Do not report the inventory as live until the rollout succeeds and the HTTP read-back returns the expected JSON.
