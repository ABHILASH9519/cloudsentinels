# CloudSentinels + local n8n

The local n8n instance is the single workflow orchestrator for cluster and AWS events. The Go API remains the authenticated event gateway for Kubernetes agents and signs events before dispatch. Zapier remains a separate optional destination.

## Local runtime

- Docker image: `n8nio/n8n:2.16.1` (pinned in `docker-compose.yml`).
- Container: n8n, bound only to 127.0.0.1:5678.
- Persistent storage: external Docker volume `n8n_data` mounted at `/home/node/.n8n`; the start script backs up an existing container data directory before migration.
- Editor: http://localhost:5678.
- Active workflow: CloudSentinels - Unified Multi-Cluster Self-Healing (ID cloudsentinelsUnified).
- Webhook: http://127.0.0.1:5678/webhook/cloudsentinels/unified-events.
- Webhook response mode: lastNode.
- Start/stop: `deploy/automation/start-local-n8n.ps1` and `deploy/automation/stop-local-n8n.ps1`.
- Publish/update helper: deploy/automation/publish-unified-workflow.ps1.
- Time zone: Asia/Kolkata; restart policy: unless-stopped.

## Workflow behavior

The active workflow accepts:
- CloudSentinels normalized JSON events.
- Authenticated Kubernetes agent events forwarded by the Go API.
- AWS EventBridge envelopes delivered by the local SQS poller.

It validates and normalizes each event, derives severity and target, routes the event through the shared triage branches, and produces a shared remediation runbook. The runbook includes the target adapter, diagnostic actions, mutation actions (if any), approval requirement, verification requirement and audit metadata.

The shared lifecycle is intake → normalize → correlate → classify → diagnose → allowlist policy → signed human approval → authorized adapter → verify → rollback/escalate → audit.

n8n does not execute arbitrary kubectl, shell or AWS CLI commands. It always reports remediationExecuted=false. Kubernetes mutation commands remain in the Go agent and require signed human approval plus the agent namespace allowlist. EC2 and Lambda actions are currently read-only diagnostics. GuardDuty/Security Hub events require human security review; automatic isolation and credential changes are disabled.

## Local cluster connection

Both local Kubernetes contexts are connected through independent Go agents:

- Minikube: context `cloudsentinels-local`, cluster ID `cloudsentinels-local`.
- Docker Desktop built-in Kubernetes: context `docker-desktop`, cluster ID `docker-desktop-kubernetes` (kind, one control-plane node, Kubernetes 1.34.3).

Both agents report telemetry every 30 seconds to the Go API at `http://127.0.0.1:8082`. The API forwards normalized online/degraded/recovery and agent events to the active n8n workflow. Both agent processes and both webhook smoke tests were verified on 2026-11-15. Use `deploy/agent/local/attach-local-clusters.ps1 -IncludeDockerDesktop` to attach/restart both agents. The script preserves the original kubeconfig between contexts. Both agents run with `mutations=false` by default. `-EnableApprovedRemediation` is an explicit opt-in that enables only the signed approval-gated command path; the API and agent namespace/action allowlists still apply. The default namespace allowlist is `cloudsentinels-system`.

## Go API configuration

Keep the following in the ignored repository-root .env.local:

~~~dotenv
N8N_WEBHOOK_URL=http://127.0.0.1:5678/webhook/cloudsentinels/unified-events
N8N_SIGNING_SECRET=<separate random secret, at least 32 characters>
~~~

The Go API reports `n8n_configured=true`, but `firebase_project_configured=false` until the Firebase project/Admin credentials are configured; `/readyz` correctly returns HTTP 503 meanwhile. The workflow records whether signature headers are present; it does not independently verify the HMAC. Keep n8n bound to loopback and do not expose port 5678 publicly. Do not treat header presence as cryptographic authentication.

Zapier remains configured separately with ZAPIER_CATCH_HOOK_URL and ZAPIER_SIGNING_SECRET. A Zapier Catch Hook URL must be created in the user's Zapier account before that destination can be live.

## AWS bridge

The AWS bridge uses a dedicated SQS queue so it does not compete with the existing CloudSentinels processor queue. CloudWatch alarm rules for the two deployed Lambda functions, EC2 event forwarding from eu-north-1, and GuardDuty/Security Hub rules are deployed in the AWS n8n bridge and server-monitor stacks. The local poller forwards queue messages to the unified webhook and deletes messages only after a successful workflow response.

AWS read-only verification on 2026-11-15 confirms `cloudsentinels-n8n-bridge` is `CREATE_COMPLETE` in `ap-south-1` and `cloudsentinels-aws-server-monitor` is `CREATE_COMPLETE` in `eu-north-1`. The dedicated n8n SQS queue has 6 visible messages. Both deployed Node.js Lambda functions are Active and the automation processor queue mapping is Enabled. The EC2 instance remains stopped. The current `My-Website` CLI session resolves to the AWS root principal; `start-aws-poller.ps1` intentionally rejects root. The existing `CloudSentinelsN8NLocalPoller` SQS-only policy is not attached to any IAM user, group, or role. Attach it to a dedicated non-root role/profile, then start `deploy/automation/start-aws-poller.ps1 -AwsProfile <least-privileged-profile> -QueueUrl https://sqs.ap-south-1.amazonaws.com/115484989078/cloudsentinels-n8n-events`.

## Verification

Synthetic test events for Kubernetes DeploymentUnhealthy, EC2 CloudWatch alarm, Lambda CloudWatch alarm and GuardDuty Finding all returned HTTP 200 from the unified webhook. The resulting runbooks selected the expected target adapters and reported NOT_EXECUTED.

The Go API agent-event endpoint accepts authenticated events. The Go test suite passes. No real AWS alarm or security finding was generated, and no production mutation was performed.
