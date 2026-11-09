# CloudSentinels workflow automation

This layer adds asynchronous event-driven automation without coupling third-party workflows to the user-facing API request path.

## Topology

```text
React/Vercel
   |
API Gateway + Cognito JWT
   |
Lambda API -----> DynamoDB (authoritative application state)
   |
   +---- PutEvents (best-effort domain event)
             |
       EventBridge bus
             |
       EventBridge rule
             |
       SQS automation queue -----> n8n SQS Trigger
             |                         |
             |                         +--> severity/routing logic
             |                         +--> Slack / Teams / email
             |                         +--> ticketing / runbook integrations
             |                         +--> call authenticated CloudSentinels API
             |
       SQS dead-letter queue (after repeated delivery failures)

Optional: n8n can call Zapier Catch Hook for integrations only available in a Zap.
Zapier is an outbound automation destination, not a second source of truth.
```

## Why n8n first

- Self-hosted and workflow definitions can be versioned/exported.
- Supports branching, conditions, retries, error workflows and AWS SQS integration.
- Can run locally only when needed; this Compose setup binds the editor to localhost.
- Zapier remains optional for quick SaaS-to-SaaS actions. Do not route core incident persistence through Zapier.

## Start locally

Requirements: Docker Desktop with Compose.

1. Copy `.env.example` to `.env`.
2. Set unique strong values for `POSTGRES_PASSWORD` and `N8N_ENCRYPTION_KEY`.
3. Start the automation service:

```powershell
docker compose --env-file .env up -d
```

4. Open http://localhost:5678 and create the n8n owner account.
5. In n8n, create an AWS credential for the SQS Trigger node. Use a dedicated least-privilege IAM identity scoped to the automation queue ARN; temporary credentials are preferred. The environment variables are provided for local development only and are not required if credentials are configured directly in n8n.
6. Configure an SQS Trigger for the queue URL printed by the AWS runtime stack output `AutomationQueueUrl`. Select the region `ap-south-1`.
7. Create a workflow with an IF/Switch node on `detail-type`, then add the appropriate notification/ticketing nodes. Enable the workflow only after testing with a non-production event.

Stop when finished:

```powershell
docker compose --env-file .env down
```

This stops n8n and PostgreSQL but preserves their named volumes. To remove local workflow/database data too, use `docker compose --env-file .env down -v` only if you intentionally want to erase it.

## Event contract

Events use the EventBridge envelope. The SQS message body contains the EventBridge event, including:

- `source`: `cloudsentinels.api`
- `detail-type`: `IncidentCreated`, `IncidentUpdated`, `AlertCreated`, or `MetricRecorded`
- `detail.userId`: Cognito subject of the actor
- `detail.resource`: minimal resource metadata (ID, severity/status/name; no raw logs or secrets)
- `detail.occurredAt`: ISO-8601 timestamp

The event contains identifiers and minimal metadata, not raw logs, access tokens, email addresses, or credentials. n8n should use a dedicated API credential or a scoped service integration when it needs to call protected application endpoints. Never forward a user's Cognito access token through a workflow.

## Reliability and safety

- DynamoDB remains the source of truth. Event publishing is best-effort and does not roll back successful API writes.
- EventBridge routes matching events to SQS. SQS retries delivery to n8n; messages that exceed the configured receive count are moved to the DLQ.
- Configure an n8n error workflow and alert on DLQ depth. Use idempotency keyed by EventBridge event ID before creating tickets or sending non-repeatable notifications.
- Do not let a workflow automatically delete incidents, disable accounts, or perform destructive remediation without an approval gate.
- Protect n8n with strong owner credentials, encryption key, restricted network access and backups. The local Compose file binds port 5678 to 127.0.0.1 only.
- This local setup is not a production deployment. For shared use, deploy n8n behind HTTPS with durable PostgreSQL backups, secret management, network restrictions and an IAM role rather than long-lived access keys.

## Cost and lifecycle

The n8n Compose stack creates no AWS compute resources. AWS EventBridge and SQS are provisioned only when the AWS runtime stack is deployed and can incur usage charges. Stopping local Docker does not pause AWS resources. The existing `aws-off.ps1` pauses the API Lambda only; it does not delete the automation queue or stop any separately hosted n8n service.
