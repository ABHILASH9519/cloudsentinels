# CloudSentinels AWS server + Lambda monitoring

This is an additive, read-only monitoring integration for the existing CloudSentinels AWS environment.

## What it monitors

| Workload | Region | Signals |
|---|---|---|
| Existing EC2 server | **eu-north-1** | Instance state changes, EC2 status-check failures, sustained CPU above 80% |
| Operations API Lambda | **ap-south-1** | Errors, throttles, duration approaching the configured timeout |
| Existing automation processor Lambda | **ap-south-1** | Errors, throttles, duration approaching the configured timeout |
| Monitoring delivery pipeline | **ap-south-1** | Queue age and processing dead-letter messages |

The current EC2 target is **i-04ddd1baceeaa4186** (tagged CloudSentinel Server). It was last observed in the **stopped** state. Instance state-change events are still monitored while it is stopped. CPU and status-check metrics become useful when the instance is running.

## Architecture

~~~text
EC2 default EventBridge bus (eu-north-1)
  ├─ instance state changes
  └─ CloudWatch alarm state changes
          │ cross-region PutEvents (scoped IAM role)
          ▼
CloudSentinels EventBridge bus (ap-south-1)
          │
          ▼
AWSMonitoringQueue ──► AWSMonitoringProcessor Lambda
          │                     │
          ▼                     ▼
   Processing DLQ          Existing DynamoDB table
                                │
                                ▼
                   USER#<AutomationOwnerId>
                   AUTOMATION#<time>#<event-id>
                                │
                                ▼
                     GET /automation/events
                     (authenticated dashboard)

CloudWatch alarm events for Lambda (ap-south-1)
          │ default EventBridge bus
          └──────────────► AWSMonitoringQueue
~~~

The processor writes the same owner-scoped automation activity key shape consumed by the existing authenticated GET /automation/events endpoint. This is why deployment requires AutomationOwnerId: it must be the exact authenticated user's subject/UID accepted by the API (Firebase UID after the Firebase-auth migration), not an email address.

## Safety boundaries

- This stack does not start, stop, reboot, terminate, resize, or otherwise mutate EC2.
- It does not deploy code to or change configuration on the monitored Lambda functions.
- It does not invoke remediation actions.
- CloudWatch alarms are informational signals. An active alarm is recorded as PENDING_APPROVAL; no AWS action is attached.
- Event processing is idempotent and uses SQS partial-batch failure responses.
- Failed EventBridge delivery and repeated Lambda processing failures have separate dead-letter queues.
- No EC2 guest agent is installed. Memory, filesystem, process, and application-level metrics require a later CloudWatch Agent/SSM configuration with an instance role and explicit authorization.

## Deployment prerequisites

1. AWS CLI v2 installed and authenticated in the local PowerShell session.
2. Existing CloudFormation stacks cloudsentinels-core and cloudsentinels-runtime in ap-south-1.
3. Existing central EventBridge bus cloudsentinels-domain-events.
4. Existing private artifact bucket cloudsentinels-sam-artifacts-<account-id>.
5. The authenticated CloudSentinels user's exact UID/subject for AutomationOwnerId.
6. Permission to create additive monitoring resources in ap-south-1 and eu-north-1, including IAM role creation and iam:PassRole.

The deployment script refuses to create a new artifact bucket automatically. It also does not change the EC2 instance state.

## Deploy

From the repository root in PowerShell:

~~~powershell
aws login
.\deploy\aws\monitoring\deploy.ps1 -AutomationOwnerId "<authenticated-user-uid>"
~~~

The script reads existing core/runtime stack outputs, installs Lambda package dependencies, runs processor tests, packages and validates the central SAM template, deploys the central monitoring stack, and then deploys the regional EC2 forwarding/alarms stack.

Defaults:
- Central region: ap-south-1
- EC2 region: eu-north-1
- EC2 instance: i-04ddd1baceeaa4186

Override the instance or regions explicitly if the monitored resource changes.

## Verify

~~~powershell
.\deploy\aws\monitoring\status.ps1
~~~

Check:
- Both CloudFormation stacks report CREATE_COMPLETE or UPDATE_COMPLETE.
- The EC2 state matches the expected operator-managed state.
- CloudWatch alarms are not unexpectedly in ALARM.
- The monitoring SQS queue age remains low and the processing DLQ is empty.
- After a real instance or Lambda alarm event, the authenticated dashboard's GET /automation/events returns the new activity row.

A successful stack deployment alone does not prove a real alarm has fired or a dashboard event has been read. Verify those separately.

## Local processor tests

~~~powershell
npm install --prefix .\deploy\aws\monitoring\processor
npm test --prefix .\deploy\aws\monitoring\processor
~~~

## Cost notes

The integration adds CloudWatch metric alarms, SQS queues, Lambda invocations, EventBridge events, and cross-region event delivery. Charges depend on actual usage and current AWS pricing. Review AWS Budgets/Cost Explorer before enabling this continuously.