# Minor-review EKS readiness runbook

## Scope and safety boundary

This runbook prepares CloudSentinels for a **non-production EKS demonstration on the minor-review day**. Until that review, do not create an EKS cluster, node group, load balancer, NAT gateway, or any other EKS-dependent AWS resource. Do not apply the Airtable showcase manifest.

The target region currently planned is `ap-south-1` (Mumbai), subject to confirmation on review day. The EKS version, VPC, subnet layout, node size/count, endpoint exposure, and maximum spend must be approved before provisioning. Do not infer these from the historical Airtable inventory.

## Verified preparation status (2026-11-10)

- AWS account: `115484989078`; region used by the existing CloudSentinels runtime: `ap-south-1`.
- EKS discovery returned **zero clusters across all 17 enabled AWS regions**.
- Existing roles named `CloudSentinels-EKS-ClusterRole` and `CloudSentinels-EKS-NodeRole` exist. Their trust principals are EKS and EC2 respectively. The cluster role currently has `AmazonEKSClusterPolicy`; the node role has `AmazonEKS_CNI_Policy`, `AmazonEC2ContainerRegistryReadOnly`, and `AmazonEKSWorkerNodePolicy`. These are baseline policies only; validate current EKS requirements, trust, and attached permissions before reuse.
- `CloudSentinelsDeploymentRole` has an inline policy scoped to the existing Cognito/DynamoDB/Lambda/EventBridge/SQS runtime resources, but it has no EKS provisioning permissions and trusts CloudFormation only. Do not treat it as an EKS cluster provisioning role or GitHub OIDC role.
- Existing `CloudSentinelsDeploymentRole` trusts CloudFormation only. It is not a GitHub Actions deployment role.
- No GitHub Actions OIDC provider (`token.actions.githubusercontent.com`) is registered in this account. The currently listed OIDC providers are Vercel providers.
- The AWS identity available to the prior audit was the account root principal. **Do not use root for deployment or create privileged credentials from it.** A dedicated administrator/deployment identity is required.
- The CloudSentinels core and runtime CloudFormation stacks are present in `ap-south-1`; their last observed statuses were `CREATE_COMPLETE` and `UPDATE_COMPLETE` respectively.
- A direct, read-only Lambda invocation of the runtime API handler's `GET /v1/health` route returned HTTP 200 with `status: ok`. This validates the handler health path, not a full external API Gateway/Cognito login flow.
- The live EventBridge rule is enabled and routes the current fixed event-type allowlist from `cloudsentinels.api` and `cloudsentinels.cluster-agent` to the automation SQS queue. Its Lambda event-source mapping is enabled and the queue had zero visible/in-flight messages at audit time.
- The PR contains a broader event rule for arbitrary detail types from API, cluster-agent, and local-agent sources, but that template change is **not deployed to the live AWS stack**. The live runtime therefore does not yet have the new dynamic event-ingestion behavior.
- Zapier receiver/relay unit tests passed in CI. This proves the code paths under test, not delivery to a live Zapier account or a configured production Zap.
- The latest AWS architecture validation run passed the SAM, CloudFormation, Lambda syntax, API, remediation, automation processor, and Zapier receiver/relay checks.

## Before provisioning on review day

All items below are gates, not assumptions:

1. **Authorize a non-root AWS operator.** Use a dedicated IAM Identity Center/admin role or an approved infrastructure administrator. Do not use the root principal for changes.
2. **Configure GitHub OIDC.** Register `https://token.actions.githubusercontent.com` as an IAM OIDC provider, then create a dedicated role restricted to:
   - audience `sts.amazonaws.com`;
   - repository `ABHILASH9519/cloudsentinels`;
   - the protected GitHub environment `minor-review` (or an equally narrow approved subject);
   - the minimum CloudFormation/S3/ECR/EKS actions required by the reviewed workflow.
3. **Protect the GitHub environment.** Require reviewer approval, restrict deployment branches, and store only non-secret deployment metadata as repository/environment variables. Never store AWS access keys.
4. **Deploy and verify the reviewed CloudSentinels runtime update.** After OIDC is configured, review the CloudFormation change set and update the EventBridge event pattern before expecting the dynamic procedure registry to receive new event types. Validate API → EventBridge → SQS → Lambda delivery with a harmless test event. Configure and test the external Zapier webhook/workflow separately; do not equate unit tests with live delivery.
5. **Approve the cost envelope.** Include EKS control-plane hours, EC2 nodes, EBS, NAT/data transfer, load balancers, CloudWatch logs/metrics, and any public IPv4 charges. Define a maximum hourly/daily budget and teardown time.
6. **Approve cluster shape.** Confirm supported EKS version at execution time, VPC and private subnets, API endpoint access restrictions, managed node group instance type/count, disk size, and autoscaling bounds.
7. **Review IAM.** Verify the existing cluster and node roles' attached/inline policies and permissions; reuse only if least-privilege and current EKS requirements are satisfied. Do not attach broad administrator policies.
8. **Review workload sources.** Use the actual application repository's reviewed Helm/Kustomize manifests and immutable image references. Airtable rows are inventory hints only, not workload specifications.

## Planned non-production topology

- One EKS control plane in `ap-south-1`.
- One small managed EC2 node group for core services and demonstration workloads, with explicit min/desired/max capacity.
- Optional Fargate profile only for workloads that are compatible with Fargate; it does not replace or eliminate the EKS control plane.
- Private worker subnets; restrict Kubernetes API endpoint access to the review team's approved network or a controlled access path.
- Required EKS add-ons: VPC CNI, CoreDNS, kube-proxy, and EBS CSI where persistent volumes are needed.
- CloudSentinels cluster agent uses a dedicated service account and least-privilege Kubernetes RBAC. Prefer EKS Pod Identity or IRSA for AWS permissions.
- Prometheus/Alertmanager or the selected telemetry adapter forwards authenticated health events to the CloudSentinels ingestion API.
- The CloudSentinels procedure registry chooses only allowlisted adapter actions; no arbitrary shell execution.

This is a target design, not a deployed cluster configuration. Exact instance types, counts, EKS version, and network CIDRs remain unset until review approval.

## Review-day execution sequence

1. Re-run AWS identity, region, quota, IAM trust/policy, and cost checks.
2. Verify the GitHub OIDC role can be assumed by the protected environment and cannot be assumed by other repositories/branches.
3. Deploy the reviewed CloudSentinels runtime change set and validate event delivery through EventBridge, SQS, and the automation processor.
4. Generate and review the EKS infrastructure change set; check estimated costs and network exposure.
5. Obtain explicit approval, then provision the non-production cluster and managed node group.
6. Install/verify EKS add-ons, metrics, CloudSentinels agent, namespace/RBAC, and authenticated event ingestion.
7. Import Airtable data as **inventory metadata only**; compare it with live API state and label records `MATCH`, `SOURCE_ONLY`, `CLUSTER_ONLY`, `DRIFT`, or `STALE`.
8. Deploy only reviewed application manifests from source control. Never convert historical Airtable pod/deployment rows directly into Kubernetes resources.
9. Run controlled tests in a dedicated test namespace (for example, a disposable CrashLoopBackOff workload and a test deployment rollout), verify incident detection, AI analysis, approved remediation, and post-action health.
10. Capture evidence: cluster version/status, node readiness, event-to-incident latency, selected procedure/version, approval record, remediation result, and verification result.
11. Tear down non-required demo resources after review, or explicitly record the owner, budget, and expiry for anything retained.

## Acceptance checklist

- [ ] Protected GitHub OIDC role assumed successfully; no long-lived AWS keys used.
- [ ] Reviewed runtime change set deployed; new event types reach the automation processor.
- [ ] External Zapier workflow delivery verified with a real test event.
- [ ] EKS cluster and node group created only after review approval.
- [ ] API endpoint and worker network exposure match the approved design.
- [ ] All nodes Ready; core add-ons healthy.
- [ ] CloudSentinels agent authenticated and scoped by least-privilege RBAC.
- [ ] Test events reach the API and create correlated incidents.
- [ ] A low-risk allowlisted remediation executes and is independently verified.
- [ ] High-risk actions remain approval-gated; unknown actions remain observe-only.
- [ ] Airtable inventory reconciles without creating workloads from sample rows.
- [ ] Cost owner, teardown/expiry, and review evidence recorded.

## Explicit non-goals before the minor review

- No EKS cluster or worker nodes.
- No import of Airtable sample rows as live Pods, Deployments, Nodes, or Cluster objects.
- No production workload deployment.
- No broad IAM policy attachment, root-user deployment, or long-lived AWS access key.
- No claim of seconds-level recovery until event-to-verification latency is measured under test.
