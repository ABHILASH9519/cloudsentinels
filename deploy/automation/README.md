# Optional n8n and Zapier integrations

CloudSentinels itself runs on AWS. The application frontend, authentication, APIs, data storage, event routing and queues remain AWS-native. **n8n and Zapier are optional external workflow tools only**; neither hosts the application backend, stores CloudSentinels application data, or is required for the product to work.

- **Zapier integration guide:** [ZAPIER.md](./ZAPIER.md) — workflow chart, sanitized payload contract, security, provisioning, and production acceptance checks. The optional relay Lambda and SAM resources are implemented in this branch but are not deployed until a Zapier secret ARN and scoped AWS deployment session are available.

## AWS application architecture

```text
Frontend (Vercel)
  -> Amazon Cognito
  -> API Gateway + Lambda
  -> DynamoDB (system of record)

Lambda domain events
  -> Amazon EventBridge
  -> Amazon SQS automation queue
  -> Automation Processor Lambda
  -> Optional external integration relay (planned)
  -> Zapier / n8n
```

The EventBridge bus and SQS queue are AWS-managed resources in the runtime stack. They buffer selected domain events without putting external automation in the critical API request path. If no external tool is connected, CloudSentinels' core API and data operations still run on AWS.

## Responsibility boundary

- **AWS / CloudSentinels:** authentication, authorization, incident persistence, event ingestion, classification, idempotency, approval policy, audit history, and Kubernetes remediation adapters.
- **Zapier:** notifications, ticket creation/update, escalation routing, and scheduled summaries.
- External workflow failures must never block core event processing or recovery.
- Zapier must never execute Kubernetes commands or mark an action recovered.

## Recommended use cases

1. Critical incident → notify Slack or Microsoft Teams.
2. High/critical incident → create or update a Jira/Linear ticket with event-ID deduplication.
3. High-risk remediation pending approval → notify an approver with a CloudSentinels link; approval remains inside CloudSentinels.
4. AWS-side recovery independently verified → post a resolution update and update the matching ticket.
5. Daily operations report → send a concise digest to email or Teams.

Do not send every raw metric to Jira. CloudSentinels should qualify and deduplicate alerts before Zapier routes them.

## Connecting n8n

Use n8n Cloud or an independently operated instance. It is not deployed by this repository. For an AWS SQS Trigger node, configure an IAM identity with queue-scoped permissions only:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ChangeMessageVisibility"
    ],
    "Resource": "<AutomationQueueArn>"
  }]
}
```

Use temporary credentials or a supported workload identity where possible. Do not use administrator credentials or put AWS secrets in frontend configuration. Do not attach a second SQS consumer to the processor queue without deliberately changing its consumer model.

## Zapier connection pattern

Create a Zapier Catch Hook and connect it only through a dedicated AWS outbound relay (planned). Do not expose the core SQS queue publicly or put a webhook URL in browser code. Store the Catch Hook URL in AWS Secrets Manager. The relay should validate event allow-lists, sanitize payloads, sign requests, apply bounded retries, and route delivery failures to a separate DLQ.

## Existing event contract

The AWS event bus accepts these event types:

- `IncidentCreated`
- `IncidentUpdated`
- `IncidentDeleted`
- `AlertCreated`
- `AlertUpdated`
- `MetricRecorded`
- Cluster events: `PodCrashLoopBackOff`, `NodeNotReady`, `CpuThresholdExceeded`, `MemoryPressure`, `DeploymentUnhealthy`, `ApiLatencyHigh`

Events use source `cloudsentinels.api` or `cloudsentinels.cluster-agent`. Do not forward raw logs, authentication tokens, passwords, kubeconfig, or unnecessary personal data to external automation services.

## Reliability and lifecycle

- DynamoDB remains the source of truth.
- EventBridge and SQS provide AWS-native buffering and dead-letter handling.
- Use event ID as the idempotency key.
- Monitor queue age and dead-letter queue depth in CloudWatch.
- The API's event publication is currently best-effort; a transactional outbox is future reliability hardening.
- The Zapier relay code and conditional SAM resources are committed; the relay is not deployed and its webhook secret is not configured yet. A synthetic event test also exposed an ES-module packaging defect in the deployed Automation Processor; the branch now includes a package manifest fix, which must be deployed before the SQS-to-DynamoDB path can be considered healthy.
- Disconnecting Zapier must not stop the AWS application.
