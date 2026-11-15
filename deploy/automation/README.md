# Unified CloudSentinels automation (local n8n)

CloudSentinels defines one local n8n workflow for a shared incident lifecycle across AWS EC2, AWS Lambda, Docker Desktop Kubernetes and standalone Minikube Kubernetes.

## Workflow definition

- Name: **CloudSentinels - Unified Multi-Cluster Self-Healing**
- n8n workflow ID: **cloudsentinelsUnified**
- Definition: [n8n-cloudsentinels-unified.json](./n8n-cloudsentinels-unified.json)
- Builder: [build-unified-workflow.js](./build-unified-workflow.js)
- Static validation: `node .\deploy\automation\test-unified-workflow.mjs`
- Local webhook path: `/webhook/cloudsentinels/unified-events`

The saved definition contains 15 nodes, including four explicit Code-node adapters:

1. **AWS EventBridge / SQS Connector**
2. **AWS Lambda / Serverless Connector**
3. **Docker Desktop Kubernetes Connector**
4. **Local Minikube Kubernetes Connector**

All four adapters are connected in the same main execution path before **Unified Remediation Policy** and **Build Shared Remediation Runbook**. They classify/enrich the normalized event envelope; they are not independent source pollers or native AWS/Kubernetes API credential nodes. Source delivery is handled by the transports below.

## Runtime status (2026-11-15)

The unified workflow is published and active in the local n8n container:

- Docker Desktop engine: reachable; Minikube and Docker Desktop each have one Ready node.
- n8n: pinned `n8nio/n8n:2.16.1`, Compose-managed, loopback-only; `/healthz` returned HTTP 200. Existing data was backed up before migration and the persistent `n8n_data` volume is retained.
- Persisted workflow: ID `cloudsentinelsUnified`, `active=true`, 15 nodes, including all four explicit connector Code nodes.
- Go API: `/healthz` returned `status=ok` on port 8082. `/readyz` correctly returns HTTP 503 because Firebase authentication is not configured.
- Both isolated Go agents are running and sending telemetry every 30 seconds with `mutations=false` by default.
- Local agent telemetry/event endpoints synchronously require n8n acceptance; failures return retryable HTTP 503 and the agents retry on their next heartbeat/scan. Other API-originated automation events use bounded background retries.
- Authenticated events from both local agents reached the Go API and the n8n execution database; the latest executions completed with `status=success`. Real Minikube degraded/recovered telemetry was routed into the workflow.
- EC2, Lambda, Docker Desktop and Minikube source-routing tests each selected the expected read-only adapter and returned `executionStatus=NOT_EXECUTED`.

**Outstanding dependencies:** Firebase Web App and Admin credentials are missing, so the authenticated dashboard/API is not ready. AWS read-only inventory confirms the n8n bridge stack in ap-south-1 and the EC2 server-monitor stack in eu-north-1 are deployed; both Node.js Lambda functions are Active and the automation processor SQS mapping is enabled. The EC2 instance is stopped. Six messages are waiting in the dedicated n8n SQS queue. The AWS CLI is authenticated as root, so the poller correctly refuses to run; the existing `CloudSentinelsN8NLocalPoller` policy is present but not attached to a least-privilege IAM principal. The Go Lambda adapter builds for Linux ARM64 but has not been deployed. Existing Node.js Operations Lambda resources are a separate runtime.

## Shared incident lifecycle

Every source follows the same stages:

1. Ingest and validate the event.
2. Normalize the CloudSentinels or AWS EventBridge envelope.
3. Preserve the event ID for correlation/idempotency.
4. Classify source, target, severity and incident route.
5. Prepare read-only diagnostics and target-specific recommendations.
6. Apply the target-specific action allowlist.
7. Require signed human approval for mutations.
8. Execute only through an authorized target adapter.
9. Verify health/rollout and record the outcome.

The n8n workflow is an orchestrator and runbook planner. It does not run arbitrary shell, kubectl, AWS CLI, or infrastructure mutations. All current connector adapters set mutation permission to false; remediation execution remains false until the separate approved agent/adapter path is invoked.

## Event transports and targets

| Target | Event transport into the one workflow | Current mutation boundary |
|---|---|---|
| Docker Desktop Kubernetes | Docker Desktop agent -> authenticated Go API -> unified n8n webhook | Read-only telemetry; approved actions must pass through the signed agent command path |
| Minikube Kubernetes | Minikube agent -> authenticated Go API -> unified n8n webhook | Read-only telemetry; approved actions must pass through the signed agent command path |
| AWS EC2 server | EventBridge -> central bus -> dedicated SQS queue -> local poller -> unified n8n webhook | Monitoring/runbook only; EC2 start/stop/reboot is not enabled |
| AWS Lambda | CloudWatch alarms/EventBridge -> dedicated SQS queue -> local poller -> unified n8n webhook | Monitoring/runbook only; alias rollback/configuration changes are not enabled |
| GuardDuty / Security Hub | EventBridge -> dedicated SQS queue -> local poller -> unified n8n webhook | Human security review; no automatic isolation or credential changes |

AWS event transport is separate from the existing production processor queue. Do not add a second consumer to that production queue.

## Build and publish

Build the workflow JSON:

~~~powershell
node .\deploy\automation\build-unified-workflow.js
node .\deploy\automation\test-unified-workflow.mjs
~~~

After Docker Desktop and the local n8n container are running, import and publish the workflow:

~~~powershell
.\deploy\automation\publish-unified-workflow.ps1
~~~

The publish script imports the generated JSON and publishes workflow ID `cloudsentinelsUnified`. Manage the pinned n8n container with `start-local-n8n.ps1` / `stop-local-n8n.ps1`; its persistent volume is retained across restarts.

## AWS SQS poller

After authenticating the least-privileged AWS profile with `aws login`, start the background consumer. It discovers `N8NEventQueueUrl` from the CloudFormation stack; pass `-QueueUrl` if the role lacks `cloudformation:DescribeStacks`:

~~~powershell
.\deploy\automation\start-aws-poller.ps1 -AwsProfile My-Website
~~~

The launcher verifies the AWS account, rejects root credentials, checks n8n health and SQS queue access, then starts the poller in the background. Stop it with `deploy/automation/stop-aws-poller.ps1`. The poller deletes an SQS message only after the local n8n webhook returns success. Expired AWS sessions cause retries; messages remain in SQS until accepted.
## Security rules

- Never put AWS credentials, agent tokens, kubeconfig contents or Firebase secrets in workflow JSON.
- Keep n8n bound to loopback; AWS reaches it through the local SQS poller.
- Kubernetes mutations require signed human approval and the agent namespace allowlist.
- EC2/Lambda mutations and security containment remain disabled until dedicated least-privilege adapters and explicit approvals are implemented.
- Monitor the SQS delivery DLQ, queue age and local poller logs.

## Authentication prerequisite

The frontend and Go API share Firebase Authentication. Add VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, and VITE_FIREBASE_APP_ID to src/frontend/.env.local. Add matching FIREBASE_PROJECT_ID and a server-side Admin credential via GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON to the ignored root .env.local. Never put Admin credentials in browser variables or source control. scripts/start-local-server.ps1 validates these values and refuses to start an apparently healthy but unauthenticated stack.
