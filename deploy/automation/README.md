# Optional n8n and Zapier integrations

CloudSentinels itself runs on AWS. The application frontend, authentication, APIs, data storage, event routing and queues remain AWS-native. **n8n and Zapier are optional external automation tools only**; neither hosts the application backend, stores CloudSentinels application data, or is required for the product to work.

## AWS application architecture

```text
Frontend (Vercel)
  -> Amazon Cognito
  -> API Gateway + Lambda
  -> DynamoDB (system of record)

Lambda domain events
  -> Amazon EventBridge
  -> Amazon SQS automation queue
  -> Optional external automation consumer (only when configured)

Amazon CloudWatch / SNS remain available for AWS-native monitoring and operational alerts.
```

The EventBridge bus and SQS queue are AWS-managed resources in the runtime stack. They buffer selected domain events so external automation can be connected without putting n8n or Zapier in the critical API request path. If no external tool is connected, CloudSentinels' core API and data operations still run on AWS.

## What to use the automation tools for

Use them only for workflows where an external SaaS integration saves time:

- **n8n:** custom multi-step workflows, conditional routing, enrichment, approvals, and integrations that need more control.
- **Zapier:** quick SaaS-to-SaaS connections such as sending a notification, creating a ticket, or adding a row to an external tracker.

Example use cases:
1. A critical incident is created → notify a selected Slack or Microsoft Teams channel.
2. An incident remains unresolved → create or update a ticket in an external issue tracker.
3. A high-severity alert arrives → send an email/SMS escalation to the on-call contact.
4. A daily operational summary is ready → send a report to an external channel.

These are optional side effects. Do not put authentication, incident persistence, core alert processing, authorization, or application business logic in n8n/Zapier.

## Connecting n8n

Use n8n Cloud or an n8n instance you independently choose to operate. It is not deployed by this repository and no n8n container, PostgreSQL instance, EC2 host, or n8n-specific AWS runtime is required by CloudSentinels.

For an AWS SQS Trigger node, configure an IAM identity with queue-scoped permissions only:

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

Use temporary credentials or a supported workload identity where possible. Do not use administrator credentials or place AWS secrets in frontend configuration.

## Connecting Zapier

Use Zapier only for specific SaaS actions. Connect it through a secured webhook/API integration or a supported AWS event consumer. Do not expose the SQS queue publicly or put a Zapier webhook secret in browser code. A dedicated AWS integration endpoint/consumer should validate a shared secret or signature, apply rate limits, and forward only the minimum event fields required by the Zap.

## Event contract

The AWS event bus publishes these event types:

- `IncidentCreated`
- `IncidentUpdated`
- `IncidentDeleted`
- `AlertCreated`
- `AlertUpdated`
- `MetricRecorded`

Each event includes the EventBridge envelope and minimal details:
- `source`: `cloudsentinels.api`
- `detail-type`: event type above
- `detail.userId`: Cognito subject of the actor
- `detail.resource`: resource identifier and selected metadata
- `detail.occurredAt`: ISO-8601 timestamp

Do not forward raw logs, authentication tokens, passwords, or unnecessary personal data to external automation services. n8n/Zapier should use a dedicated scoped credential for any callback into CloudSentinels.

## Reliability and operational boundaries

- DynamoDB remains the source of truth.
- EventBridge and SQS provide AWS-native buffering and dead-letter handling.
- External automation failures must not make core application features unavailable.
- Use idempotency based on the EventBridge event ID to avoid duplicate tickets or notifications.
- Add approval gates before destructive remediation or account/incident deletion.
- Monitor queue age and dead-letter queue depth in CloudWatch.
- Event publication is currently best-effort from the API. For workflows that must never miss an event, a transactional outbox is a future hardening requirement.

## Cost and lifecycle

No n8n or Zapier runtime is created or billed by the CloudSentinels AWS deployment. The AWS EventBridge bus and SQS queues are part of the AWS runtime stack and can incur usage charges. Any n8n/Zapier subscription or hosting cost is separate and applies only if you choose to connect and use that service. Stopping or disconnecting an automation tool does not stop the AWS application.
