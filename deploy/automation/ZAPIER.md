# CloudSentinels + Zapier automation blueprint

> Status: integration code and optional SAM infrastructure are committed. The relay is not deployed because the current AWS session is root and the scoped deployment identity is not available; the Zapier Catch Hook URL has not been provisioned.

## Responsibility boundary

- **CloudSentinels / AWS** owns event ingestion, event classification, idempotency, incident state, approvals, audit history, and any future Kubernetes remediation adapter.
- **Zapier** is an optional workflow layer for notifications, ticketing, escalation, reporting, and human approval collection. CloudSentinels remains authoritative for policy checks and approval state.
- A Zap failure must never block incident creation, event processing, or a recovery action.
- Zapier must never call Kubernetes directly or mark a recovery successful.

## Architecture

```mermaid
flowchart TD
  A[CloudSentinels API / Cluster Agent] --> B[Amazon EventBridge]
  B --> C[Amazon SQS: automation-events]
  C --> D[Automation Processor Lambda]
  D --> E[(DynamoDB: automation run)]
  D --> F{Classification}
  F -->|High risk| G[Pending human approval]
  F -->|No target / unknown| H[Blocked or observed]
  F -->|Eligible action| G[Pending approval or policy gate]
  D -. selected, sanitized event .-> J[Optional sanitized outbound relay]
  J --> K[Zapier Catch Hook]
  K --> L[Filter / Paths]
  L --> M[Slack or Microsoft Teams]
  L --> N[Jira / Linear ticket]
  L --> O[Email escalation]
  L --> P[Human approval or approved low-risk policy]
  P --> Q[Signed POST /automation/commands]
  Q --> R[Remediation command SQS]
  R --> S[Policy-gated remediation worker]
  S --> T[Reviewed adapter]
  T --> U[Independent recovery verification]
```

The optional relay is implemented in `deploy/aws/serverless/zapier-relay/index.js` and its conditional AWS resources are defined in `runtime-template.yaml`. It is created only when `ZapierWebhookSecretArn` is supplied. Do not configure Zapier to poll the core SQS queue: the Automation Processor is its consumer and owns that queue's retry semantics.

## Recommended Zaps

| Zap | Trigger | Filter / routing | Action |
|---|---|---|---|
| Critical incident | Catch Hook: `incident.created` or `automation.state_changed` | severity = critical | Notify on-call Slack/Teams channel and email |
| Ticket sync | Catch Hook: `incident.created` | severity in high/critical; dedupe by `eventId` | Create Jira/Linear issue; save external ticket ID in Zapier storage or ticket fields |
| Approval request | Catch Hook: `automation.approval_required` | approval status = pending | Notify approver with CloudSentinels deep link; Zapier may collect a human approval, but only the signed callback to CloudSentinels records the approval state and queues an eligible command |
| Recovery result | Catch Hook: `automation.recovery_verified` | `recoveryVerified = true` only | Post resolved update and close/update matching ticket |
| Daily digest | Schedule by Zapier | query/report source is a trusted CloudSentinels report endpoint | Send summary email or Teams post |

Do not send every raw metric to Jira. Alert thresholds and deduplication belong in CloudSentinels; Zapier routes already-qualified state changes.

## Sanitized webhook contract

The relay sends only the following allow-listed fields (unknown fields are dropped). `ownerId` is the opaque Cognito subject and `eventTime` binds the callback to the exact owner-scoped DynamoDB event record:

```json
{
  "schemaVersion": "1",
  "eventId": "<EventBridge event id>",
  "ownerId": "<opaque-cognito-sub>",
  "eventTime": "2026-11-10T08:00:00.000Z",
  "eventType": "PodCrashLoopBackOff",
  "source": "cloudsentinels.api",
  "occurredAt": "2026-11-10T08:00:00.000Z",
  "severity": "high",
  "resourceId": "<alert-id>",
  "clusterRef": "demo-cluster",
  "status": "PENDING_CLUSTER_ADAPTER",
  "risk": "high",
  "recommendedAction": "inspect-workload-and-rollback-if-approved",
  "requiresApproval": true,
  "recoveryVerified": false
}
```

Use opaque cluster references, not kubeconfig, API-server addresses, pod logs, environment variables, credentials, JWTs, or raw user records. Only emit `automation.recovery_verified` after the AWS-side adapter has independently checked the post-action cluster state.

## Secure connection pattern

1. In Zapier, create a Catch Hook trigger and copy its generated URL.
2. Store that URL in AWS Secrets Manager as a secret named for this integration. Do not put it in Git, CloudFormation parameters, frontend variables, or chat messages.
3. Deploy the optional SAM relay by supplying `ZapierWebhookSecretArn`; the Lambda is granted `secretsmanager:GetSecretValue` only on that secret and receives events through its own EventBridge rule and SQS queue.
4. Relay only an allow-listed payload; sign requests with an HMAC secret and include a timestamp and event ID. Verify signature and reject stale/replayed requests if the receiving endpoint supports verification; otherwise use a dedicated authenticated relay endpoint in front of Zapier.
5. Use bounded retries, exponential backoff, an SQS delivery DLQ, and idempotency keyed by `eventId`. Treat Zapier's successful webhook receipt as delivery, not proof that every downstream Zap action succeeded.
6. Keep the Zap disabled until the test payload has been validated and the destination channel/project is confirmed.

**Important:** Zapier Catch Hook URLs are bearer secrets. Anyone who obtains one may be able to trigger the Zap. Rotate it immediately if exposed.


### Signed approval callback contract

After a human approves a high-risk action (or an explicitly configured low-risk policy path approves it), Zapier must POST this payload to `/automation/commands` and sign the exact JSON body with the command signing secret:

```json
{
  "eventId": "<eventId from the relay>",
  "eventTime": "<eventTime from the relay>",
  "ownerId": "<ownerId from the relay>",
  "commandId": "<new stable UUID for this approval attempt>",
  "action": "<recommendedAction from the relay>",
  "approvalStatus": "approved",
  "approvedBy": "<human approver identity or zapier-auto-policy>"
}
```

The receiver verifies the HMAC and timestamp, loads the exact `USER#ownerId / AUTOMATION#eventTime#eventId` record, and checks the stored action, risk, approval policy, and cluster target. It returns HTTP 503 while remediation execution is disabled or the reviewed adapter is not configured. A successful approval is only queued; it is not proof that remediation ran or recovery succeeded.

## Current AWS resources and readiness

Region: `ap-south-1`

- EventBridge bus: `cloudsentinels-domain-events`
- Core event queue: `cloudsentinels-automation-events`
- Processor: `cloudsentinels-runtime-AutomationProcessor-UDoJ0RbU1Fd8`
- Processor DLQ: `cloudsentinels-automation-dlq`
- Event delivery DLQ: `cloudsentinels-automation-delivery-dlq`
- State table: `cloudsentinels-core-app`

The EventBridge → SQS → Automation Processor path is provisioned. The processor records classifications and deliberately does not execute Kubernetes API calls until a cluster target, adapter, scoped RBAC, and approval policy are configured. The Zapier relay, webhook secret, and Zap workflows are not yet provisioned.

## Acceptance checks before enabling production Zaps

- [ ] Relay receives only approved event types and allow-listed fields.
- [ ] Secrets Manager secret is populated outside source control.
- [ ] Duplicate EventBridge deliveries do not create duplicate tickets or repeated alerts.
- [ ] A Zapier outage leaves CloudSentinels processing healthy and queues delivery for retry.
- [ ] DLQ alarms and replay procedure are documented.
- [ ] High-risk remediation remains pending until a signed approval callback is recorded in CloudSentinels.
- [ ] Duplicate in-flight SQS deliveries never invoke the same adapter command twice; stuck EXECUTING records require operator review.
- [ ] A recovery notification is emitted only after the Kubernetes adapter verifies the resulting state.


## Provisioning the webhook secret and deploying

Create a private local JSON file (never commit it) with this exact shape:

```json
{
  "webhookUrl": "https://hooks.zapier.com/hooks/catch/REPLACE_WITH_YOUR_HOOK/",
  "signingSecret": "REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS"
}
```

Create the secret in `ap-south-1` using a dedicated deployment identity:

```powershell
aws secretsmanager create-secret --name cloudsentinels/zapier/webhook --secret-string file://zapier-secret.json --region ap-south-1
```

Use the returned secret ARN as `ZapierWebhookSecretArn` in the SAM deployment. If the parameter is omitted or empty, the relay resources remain disabled and the rest of CloudSentinels deploys unchanged. Do not print the secret value or put the webhook URL in GitHub Actions logs.

After deployment, send a synthetic low-risk test incident and verify: EventBridge matched it, the dedicated relay queue received it, the Lambda logged an accepted webhook response, and the Zap performed the expected destination action. Confirm duplicate event IDs do not create duplicate tickets (use Zapier-side dedupe keyed by `eventId`).

The HMAC headers are provided for downstream verification. A Zapier Catch Hook does not automatically validate this signature; if signature verification is required, add a verification step or place an authenticated verifier endpoint in front of the Zap. Keep the Catch Hook URL private regardless.


## Runtime deployment note

A live synthetic EventBridge test exposed an existing Lambda packaging defect in the deployed Automation Processor: Node.js 22 was loading `automation/index.js` as CommonJS even though it uses ES-module imports. This caused `Runtime.UserCodeSyntaxError: Cannot use import statement outside a module`, leaving the SQS message unprocessed and no automation record in DynamoDB.

This branch now includes `automation/package.json` with `"type": "module"` and pinned AWS SDK v3 runtime dependencies, plus the equivalent package manifest for the new Zapier relay. The API function already had its own ES-module package manifest. The fix is committed but **must be deployed to the existing runtime stack** before treating event processing as healthy. CI now runs `sam build` to install each function's dependencies and catch packaging issues before deployment.
