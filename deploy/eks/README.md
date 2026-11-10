# Review-day EKS provisioning

This directory contains the non-production EKS infrastructure template and Airtable inventory validator prepared for the CloudSentinels review run. Committing or testing these files does not provision AWS resources.

## Provisioning safety contract

- The only provisioning entry point is the manually dispatched workflow `.github/workflows/eks-review-day.yml`.
- The workflow is bound to the protected GitHub environment `minor-review`. Configure required reviewers and restrict deployment branches in repository Settings before use.
- The workflow uses GitHub OIDC, not long-lived AWS access keys.
- Set environment variables `AWS_ROLE_ARN`, `AWS_REGION=ap-south-1`, `AWS_ACCOUNT_ID`, and `EKS_CLOUDFORMATION_EXECUTION_ROLE_ARN` on the protected environment. Restrict the OIDC role to passing only this dedicated CloudFormation execution role.
- The OIDC trust policy must restrict audience to `sts.amazonaws.com` and subject to `repo:ABHILASH9519/cloudsentinels:environment:minor-review`. The CloudFormation execution role must trust `cloudformation.amazonaws.com` and use narrowly scoped EKS/VPC describe and `iam:PassRole` permissions.
- Every operation requires `review_approved=true`; create and destroy also require exact confirmation strings.
- No push, pull-request, schedule, or reusable-workflow trigger exists.
- The template consumes owner-approved VPC/private subnet IDs and pre-reviewed EKS cluster/node IAM role ARNs. It does not create a VPC or IAM roles.
- Public API endpoint access requires a narrow CIDR allowlist; private endpoint access is also enabled. Never use `0.0.0.0/0`.
- The managed node group is capped at five nodes.
- EKS is not provisioned before explicit review-day approval.

## Airtable inventory input

Airtable is inventory/reconciliation input, not a cluster specification or workload source. Export only:

- Kubernetes Clusters: Cluster Name, Environment, Status, Node Count, Pod Count, Onboarding Date, Health Status.
- Nodes: Node Name, Cluster, Status, CPU Usage (%), Memory Usage (MB), Disk Usage (GB), Node Health Status, Last Seen.
- Pods: Pod Name, Node, Namespace, Status, Restart Count, Container Count, Pod Health Status, Last Restart Time.
- Deployments: Deployment Name, Cluster, Namespace, Replicas, Status, Deployment Tool, Deployment Timestamp, Git Repository URL, Deployed Commit SHA.

Never export Kubeconfig, Secure Onboarding Token, attachments, API credentials, or other secrets. Configure a read-only Airtable personal access token as the protected environment secret `AIRTABLE_API_TOKEN` (scope it to this base and record-read access only). Normalize the cluster export to:

```json
{
  "source": "Cloud-Sentinel",
  "clusters": [
    {
      "clusterName": "review-cluster",
      "environment": "Development",
      "status": "Active",
      "onboardingDate": "2026-11-01T00:00:00.000Z",
      "nodeCount": 2,
      "podCount": 8
    }
  ],
  "liveClusters": [
    { "clusterName": "review-cluster", "nodeCount": 2, "podCount": 8 }
  ]
}
```

Fetch the live allowlisted cluster table directly from Airtable (the token is read from the environment and is never written to the output):

```bash
AIRTABLE_API_TOKEN=... node scripts/eks/fetch-airtable-inventory.mjs --output ./airtable-inventory.safe.json
node scripts/eks/validate-airtable-inventory.mjs --input ./airtable-inventory.safe.json --stale-after-days 90
```

Run the validator tests locally:

```bash
node scripts/eks/validate-airtable-inventory.mjs --input ./airtable-inventory.safe.json --stale-after-days 90
node --test scripts/eks/validate-airtable-inventory.test.mjs
```

The validator rejects secret-bearing keys and malformed records, then labels source/live comparisons `MATCH`, `SOURCE_ONLY`, `CLUSTER_ONLY`, `DRIFT`, or `STALE`. Historical Airtable records are expected to be marked stale. The output is evidence only; it never generates infrastructure parameters or Kubernetes manifests from Airtable.

## Review-day execution

1. Confirm AWS account, region, operator identity, EKS quotas, budget, and teardown owner.
2. Configure and test the protected GitHub OIDC environment and least-privilege role.
3. Select an EKS version supported in the region on the day, VPC with at least two private subnets in distinct AZs, cluster/node IAM roles, instance type, node count, and narrow API CIDRs.
4. Run workflow operation `plan`; inspect the CloudFormation change set and cost/network impact.
5. Obtain the required GitHub environment approval. Run operation `create` with `review_approved=true` and exact confirmation `CREATE-CLOUDSENTINELS-EKS`.
6. Install and verify EKS managed add-ons (VPC CNI, CoreDNS, kube-proxy, and EBS CSI if storage is needed), then configure CloudSentinels agent/RBAC and authenticated monitoring ingestion.
7. Deploy only reviewed Helm/Kustomize workloads from their real source repositories. Do not recreate Airtable's historical Pods or Deployments.
8. Run controlled failure/remediation/verification scenarios and capture audit evidence.
9. Run operation `destroy` with exact confirmation `DESTROY-CLOUDSENTINELS-EKS` after review, unless an owner approves a time-bounded retention plan.

## Template scope and limitations

The CloudFormation template creates an EKS control plane and managed EC2 node group in an existing VPC. It does not create VPC/NAT, IAM roles, add-ons, agent, Prometheus, or application workloads. Public endpoint CIDRs are required because a standard GitHub-hosted runner cannot reach a private-only Kubernetes API. For private-only access, use an approved self-hosted runner inside the VPC and update the design first. A change-set plan is non-provisioning; executing create incurs charges.
