# Unified CloudSentinels automation (local n8n)

CloudSentinels uses one local n8n workflow for the shared incident lifecycle across AWS EC2, AWS Lambda, Kubernetes clusters and supported security findings.

## Active workflow

- Name: **CloudSentinels - Unified Multi-Cluster Self-Healing**
- n8n workflow ID: **cloudsentinelsUnified**
- Local webhook: http://127.0.0.1:5678/webhook/cloudsentinels/unified-events
- Webhook response mode: **lastNode** — an upstream poller receives success only after the workflow has completed.
- Source definition: [n8n-cloudsentinels-unified.json](./n8n-cloudsentinels-unified.json)
- Rebuild, import, publish and restart local n8n: .\deploy\\automation\\publish-unified-workflow.ps1

The previous event-triage workflow has been unpublished. The unified workflow is the active local n8n entry point.

## Shared incident lifecycle

Every source follows the same stages:

1. Ingest and validate the event.
2. Normalize the event envelope (CloudSentinels JSON or AWS EventBridge).
3. Carry the source event ID as the idempotency/correlation key (the Go API applies a dispatch cooldown and the AWS SQS poller caches processed IDs locally).
4. Classify severity and target environment.
5. Collect or request read-only diagnostics.
6. Evaluate the target-specific action allowlist.
7. Require signed human approval for every mutation.
8. Execute only through an authorized target adapter.
9. Verify service health / rollout.
10. Escalate or roll back if verification fails.
11. Record the outcome and audit metadata.

The n8n workflow is the **orchestrator and planner**. It does not execute arbitrary shell, kubectl, AWS CLI, or infrastructure mutations. It sets remediationExecuted=false and outputs a shared runbook with the selected adapter, recommended actions, approval requirement and verification path.

## Target adapters and current boundaries

| Target | Event intake | Current actions |
|---|---|---|
| Kubernetes | Authenticated Go agent → Go API POST /api/v1/agent/events → n8n | Read-only diagnostics; deployment restart/rollback only through the existing signed-approval agent command path and namespace allowlist |
| AWS EC2 server | EventBridge in eu-north-1 → central domain bus → dedicated SQS bridge → local poller → n8n | State/status/CPU diagnostics; no start, stop, reboot or SSM remediation is enabled |
| AWS Lambda | CloudWatch alarms in ap-south-1 → dedicated SQS bridge → local poller → n8n | Errors, throttles, duration and log/concurrency diagnostics; alias rollback/configuration changes are not enabled |
| AWS event pipeline | CloudWatch alarm for the n8n delivery DLQ → dedicated SQS bridge → local poller → n8n | EventBridge rule, SQS queue-age and delivery-DLQ diagnostics; queue purges and retry-policy changes are not automated |
| GuardDuty / Security Hub | AWS default EventBridge bus → dedicated SQS bridge → local poller → n8n | Evidence preservation and human security review; no automatic isolation or credential changes |

Security events and unrecognized targets are escalated rather than automatically mutated. "All possible threats" cannot be guaranteed by a workflow alone: coverage depends on which AWS security services, CloudWatch alarms, Kubernetes signals and application telemetry are enabled.

## Local Kubernetes agent

The running local Minikube cluster is:

- Kubernetes context: **cloudsentinels-local**
- CloudSentinels cluster ID: **cloudsentinels-local**
- API: http://127.0.0.1:8082
- Telemetry interval: 30 seconds
- Mutations: enabled only for signed/approved agent commands
- Namespace allowlist: **cloudsentinels-system**

The agent runs as a local process with a context-scoped copy of the user's kubeconfig. The copy and logs are stored under %LOCALAPPDATA%\CloudSentinels\agents, not in Git. The agent code also enforces a namespace allowlist; by default, restart/rollback is restricted to cloudsentinels-system. Read-only collection covers cluster nodes, pods, warning events, deployments and available CPU/memory metrics.

Start or restart the local agent:

~~~powershell
.\deploy\agent\local\start-agent.ps1 -ClusterId cloudsentinels-local -Context cloudsentinels-local -ApiUrl http://127.0.0.1:8082 -AllowedNamespaces cloudsentinels-system -EnableApprovedRemediation
~~~

Stop it:

~~~powershell
.\deploy\agent\local\stop-agent.ps1 -ClusterId cloudsentinels-local
~~~

The Docker Desktop built-in Kubernetes feature is currently disabled. The screenshot shows its **Create cluster** screen. After selecting Create cluster and confirming the `docker-desktop` context is Ready, attach it with the helper:

~~~powershell
.\deploy\agent\local\attach-local-clusters.ps1 -IncludeDockerDesktop
~~~

This starts one isolated Go agent per cluster, both forwarding to the same API and unified n8n workflow. A separate stale kubeconfig context named `minikube` exists but is not the active standalone cluster; use `cloudsentinels-local`.

## AWS → local n8n bridge

AWS cannot call a loopback-only n8n webhook on this workstation. The bridge therefore uses a **dedicated SQS queue**, separate from the existing CloudSentinels processor queue, and a local poller:

~~~text
EC2 eu-north-1 ── EventBridge cross-region forwarder ─┐
Lambda CloudWatch alarms ap-south-1 ─────────────────┤
GuardDuty / Security Hub ap-south-1 ─────────────────┤
CloudSentinels domain event bus ─────────────────────┘
                         |
                         v
              Dedicated N8NEventQueue
                         |
             Local AWS CLI SQS poller
                         |
                         v
              One local n8n webhook
                         |
               Shared incident lifecycle
~~~

Infrastructure as code:

- [n8n-bridge-template.yaml](../aws/monitoring/n8n-bridge-template.yaml) — SQS queue/DLQ, EventBridge rules, Lambda error/throttle/duration alarms, GuardDuty/Security Hub forwarding.
- [server-template.yaml](../aws/monitoring/server-template.yaml) — EC2 state-change and CloudWatch alarm forwarding from eu-north-1.
- [deploy-n8n-bridge.ps1](../aws/monitoring/deploy-n8n-bridge.ps1) — deploys both stacks using an existing least-privileged AWS CLI identity.
- [poll-aws-events.ps1](./poll-aws-events.ps1) — long-polls the dedicated queue, posts events to local n8n, and deletes SQS messages only after a successful workflow response. A local event-ID cache prevents repeated deliveries from being processed twice.

Start the local poller (after authenticating an IAM profile with SQS ReceiveMessage/DeleteMessage access to this queue):

~~~powershell
.\deploy\automation\poll-aws-events.ps1 -QueueUrl https://sqs.ap-south-1.amazonaws.com/115484989078/cloudsentinels-n8n-events -Region ap-south-1 -AwsProfile <least-privileged-profile>
~~~

The AWS stacks are now deployed successfully: `cloudsentinels-n8n-bridge` in ap-south-1 and `cloudsentinels-aws-server-monitor` in eu-north-1. The central stack provisions the dedicated n8n SQS queue/DLQ, EventBridge rules for the CloudSentinels domain bus, CloudWatch alarm events and security findings, plus six Lambda error/throttle/duration alarms. The server stack forwards EC2 state-change and server alarm events to the central bus and monitors the existing EC2 instance without starting/stopping it. The local AWS CLI still has no authenticated profile, so the SQS poller is not yet running. A least-privilege IAM policy is ready to attach to the local SSO role: `arn:aws:iam::115484989078:policy/CloudSentinelsN8NLocalPoller`. After `aws sso login --profile <least-privileged-profile>`, start it with the queue URL below. Do not attach it to the existing processor queue.

## Validation performed

- n8n workflow JSON generated and imported.
- Unified workflow published and activated in local n8n.
- Local n8n health endpoint returned HTTP 200.
- Synthetic Kubernetes DeploymentUnhealthy event returned a Kubernetes approval-required runbook.
- Synthetic EC2 alarm returned an AWS EC2 manual-review runbook.
- Synthetic Lambda alarm returned an AWS Lambda manual-review runbook.
- Synthetic GuardDuty finding returned a security-review-required runbook.
- All four test responses explicitly reported executionStatus=NOT_EXECUTED.
- Go API agent-event endpoint accepts authenticated events; Go test suite passes.
- Both AWS CloudFormation stacks reached CREATE_COMPLETE in their respective regions.
- A synthetic CloudSentinels event was accepted by the central EventBridge bus and delivered to the dedicated SQS queue; the test message was removed.
- The local AWS CLI profile is not authenticated, so end-to-end SQS-to-local-n8n polling remains pending.
- No real AWS alarm, threat finding, EC2 mutation or Lambda mutation was generated or executed by these tests.

## Security and operating rules

- Never put AWS credentials, agent tokens, kubeconfig contents or Firebase secrets in the workflow JSON.
- Keep n8n bound to loopback; the AWS bridge polls SQS locally.
- Mutating Kubernetes actions require signed human approval and the agent namespace allowlist.
- EC2/Lambda mutations and security containment remain disabled until dedicated least-privilege adapters and explicit approvals are implemented.
- Use a separate SQS queue for n8n; do not add a second consumer to the production processor queue.
- Monitor the SQS delivery DLQ, queue age and local poller logs.
