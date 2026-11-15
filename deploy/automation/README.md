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

The workflow definition and its four adapter scripts pass local static/fixture validation. A live n8n publish or execution could not be verified during the latest check:

- Docker CLI could not connect to the Docker Desktop Linux engine named pipe.
- No Docker containers were listed by the Docker daemon.
- Local n8n health check at `http://127.0.0.1:5678/healthz` failed to connect; port 5678 had no listener.
- Kubernetes API requests to both `docker-desktop` and `cloudsentinels-local` were refused. Their kubeconfig contexts exist, but neither cluster is currently verified reachable.

Do not treat a saved workflow JSON, kubeconfig context, or prior test record as proof that the current local services are running. The publish script below requires a running Docker daemon and an n8n container.

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

The publish script imports the generated JSON, publishes workflow ID `cloudsentinelsUnified`, restarts the n8n container, and checks its health endpoint. It must complete successfully before the workflow can be called live/published.

## AWS SQS poller

After authenticating a least-privileged AWS profile with ReceiveMessage/DeleteMessage access to the dedicated queue, run:

~~~powershell
.\deploy\automation\poll-aws-events.ps1 -QueueUrl https://sqs.ap-south-1.amazonaws.com/115484989078/cloudsentinels-n8n-events -Region ap-south-1 -AwsProfile <least-privileged-profile>
~~~

The poller deletes an SQS message only after the local n8n webhook responds successfully. The current workstation did not have an authenticated AWS CLI profile at the last documented check, so continuous SQS-to-local-n8n delivery must be verified after login.

## Security rules

- Never put AWS credentials, agent tokens, kubeconfig contents or Firebase secrets in workflow JSON.
- Keep n8n bound to loopback; AWS reaches it through the local SQS poller.
- Kubernetes mutations require signed human approval and the agent namespace allowlist.
- EC2/Lambda mutations and security containment remain disabled until dedicated least-privilege adapters and explicit approvals are implemented.
- Monitor the SQS delivery DLQ, queue age and local poller logs.
