import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const tableName = process.env.TABLE_NAME;
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const text = (value, max = 256) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

export function classifyAwsEvent(event) {
  const detailType = text(event?.["detail-type"], 100) ?? "Unknown";
  const detail = event?.detail && typeof event.detail === "object" ? event.detail : {};

  if (event?.source === "aws.ec2" && detailType === "EC2 Instance State-change Notification") {
    const state = text(detail.state, 32) ?? "unknown";
    const instanceId = text(detail["instance-id"], 64);
    return {
      eventType: "EC2InstanceStateChanged",
      resourceId: instanceId,
      severity: state === "terminated" ? "critical" : ["stopped", "stopping", "shutting-down"].includes(state) ? "medium" : "low",
      status: "OBSERVED",
      risk: "informational",
      requiresApproval: false,
      recommendedAction: null,
      reason: `EC2 instance state changed to '${state}'. CloudSentinels records the event but never starts, stops, or terminates an instance automatically.`,
      resourceState: state,
    };
  }

  if (event?.source === "aws.cloudwatch" && detailType === "CloudWatch Alarm State Change") {
    const alarmName = text(detail.alarmName, 256);
    const state = text(detail.state?.value, 32) ?? "unknown";
    const alarmIsCritical = /statuscheckfailed|errors|dead.?letter|dlq/i.test(alarmName ?? "");
    const active = state === "ALARM";
    return {
      eventType: "CloudWatchAlarmStateChanged",
      resourceId: alarmName,
      severity: active ? (alarmIsCritical ? "critical" : "high") : state === "OK" ? "low" : "medium",
      status: active ? "PENDING_APPROVAL" : "OBSERVED",
      risk: active ? (alarmIsCritical ? "critical" : "high") : "informational",
      requiresApproval: active,
      recommendedAction: null,
      reason: active
        ? "A CloudWatch alarm entered ALARM. Operator review is required; no AWS resource mutation is configured."
        : `CloudWatch alarm state changed to '${state}'.`,
      resourceState: state,
    };
  }

  return {
    eventType: detailType,
    resourceId: null,
    severity: "low",
    status: "OBSERVED",
    risk: "informational",
    requiresApproval: false,
    recommendedAction: null,
    reason: "AWS event received; no automated action is configured for this event type.",
    resourceState: null,
  };
}

async function recordEvent(event) {
  const ownerId = process.env.AUTOMATION_OWNER_ID;
  if (!tableName) throw new Error("TABLE_NAME is not configured.");
  if (!ownerId) throw new Error("AUTOMATION_OWNER_ID is not configured.");
  const id = text(event?.id, 128);
  if (!id) throw new Error("EventBridge message is missing a valid event id.");

  const classification = classifyAwsEvent(event);
  const eventTime = text(event?.time, 40) ?? new Date().toISOString();
  const now = new Date().toISOString();
  const item = {
    PK: `USER#${ownerId}`,
    SK: `AUTOMATION#${eventTime}#${id}`,
    id,
    ownerId,
    source: text(event?.source, 128) ?? "aws.unknown",
    eventType: classification.eventType,
    eventTime,
    createdAt: now,
    status: classification.status,
    recommendedAction: classification.recommendedAction,
    risk: classification.risk,
    requiresApproval: classification.requiresApproval,
    clusterName: null,
    resourceId: classification.resourceId,
    severity: classification.severity,
    reason: classification.reason,
    resourceState: classification.resourceState,
    recoveryVerified: false,
  };

  try {
    await db.send(new PutCommand({
      TableName: tableName,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    }));
    console.info("AWS monitoring event recorded", {
      eventId: id,
      eventType: item.eventType,
      status: item.status,
    });
  } catch (error) {
    if (error?.name === "ConditionalCheckFailedException") {
      console.info("Duplicate AWS monitoring event ignored", { eventId: id });
      return;
    }
    throw error;
  }
}

export async function handler(sqsEvent) {
  const batchItemFailures = [];
  for (const record of sqsEvent?.Records ?? []) {
    try {
      await recordEvent(JSON.parse(record.body ?? "{}"));
    } catch (error) {
      console.error("AWS monitoring event processing failed", {
        messageId: record.messageId,
        errorName: error?.name ?? "Error",
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
