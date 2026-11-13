# CloudSentinels real-environment operations

This runbook describes the actual local Kubernetes environment and AWS deployment boundaries. Airtable is the inventory source; it is not a kubeconfig provider or infrastructure provisioning specification.

## Local Docker-backed Kubernetes

Prerequisites: Docker Desktop running, Minikube, kubectl, Go, pnpm dependencies, and the deployed Cognito user pool / AWS API Gateway runtime. The local startup script configures Cognito JWT validation on the Go API and starts the frontend without a mock user.

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local-server.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\kubernetes\start-local-cluster.ps1
```

The Kubernetes script starts the `cloudsentinels-local` Minikube profile using Docker, waits for a Ready node, mounts the sanitized Airtable export as a ConfigMap, exposes it through an in-cluster HTTP service, and starts the read-only CloudSentinels Go agent. The agent polls the local Kubernetes API and posts real node/pod counts and warning events to the Go API. It does not synthesize nodes or pods from Airtable's reported counts.

Verify:

```powershell
kubectl --context cloudsentinels-local get nodes -o wide
kubectl --context cloudsentinels-local get pods -n cloudsentinels-system -o wide
kubectl --context cloudsentinels-local get configmap cloudsentinels-airtable-inventory -n cloudsentinels-system
kubectl --context cloudsentinels-local port-forward -n cloudsentinels-system svc/airtable-inventory 18080:80
```

In another terminal, request `http://127.0.0.1:18080/inventory/inventory.json`. The response contains the same sanitized 20-cluster Airtable snapshot stored in Git. Live agent counts are separate telemetry and must not overwrite the source inventory.

## Airtable source and data-quality constraints

Base: `Cloud-Sentinel` (`app3xn3iXAsm7MgA7`), table: `Kubernetes Clusters`.

The current source has 20 cluster rows, 15 node rows, and 15 pod rows. None of the node rows has a cluster link, and the cluster rows have no kubeconfig attachments. Child-table telemetry timestamps are historical. API endpoint strings are reported metadata and have not been authenticated. Do not use the Secure Onboarding Token field as a Kubernetes credential. A live remote cluster requires a real kubeconfig/role-based access path and an agent registration token created for that cluster.

## AWS architecture and review-day EKS

The AWS account already has a deployed serverless runtime: API Gateway HTTP API, two Lambda functions, DynamoDB, EventBridge and SQS in `ap-south-1`. The Go online-server component is not currently hosted on EC2. No EKS cluster or EC2 instance was present at the last inventory check.

EKS creation is intentionally deferred until the review-day deployment window. The existing `.github/workflows/eks-review-day.yml` is the controlled provisioning path. It requires a protected GitHub environment, GitHub OIDC role, reviewed network inputs, a change-set plan, and an explicit execute confirmation. Do not create an EKS cluster from the Airtable cluster row count or use placeholder endpoint/token fields as AWS/Kubernetes credentials.

The current default VPC has public subnets only. The EKS template expects owner-approved private subnets. Before the review-day plan, reconcile the network design (private subnets plus NAT/VPC endpoints, or an explicitly reviewed public-subnet design with a narrow API CIDR allowlist). Never expose the Kubernetes API to `0.0.0.0/0`.

EKS worker nodes are EC2 instances managed by the EKS node group. If the Go API also needs a standalone EC2 host, provision it as a separate, SSM-managed component with a scoped instance profile, TLS ingress, CloudWatch logs, and a tested deployment artifact. Do not confuse Lambda with EC2: Lambda remains the independent serverless API/automation runtime.

## Acceptance checks

- [ ] Local Minikube node is Ready and inventory ConfigMap has 20 cluster rows.
- [ ] Local agent reports real node/pod counts to CloudSentinels.
- [ ] Airtable refresh is configured server-side with a read-only PAT; no PAT is stored in Git or Vite variables.
- [ ] EKS is created only after network, IAM, region, node type, API CIDR and cost review.
- [ ] EC2 online server is reachable over TLS and manageable through SSM.
- [ ] Lambda/API Gateway health and authenticated routes are verified.
- [ ] Cloud and local agents are registered separately; inventory data and live telemetry are displayed as distinct sources.
