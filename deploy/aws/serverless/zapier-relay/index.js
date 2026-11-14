import { createHmac } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const secrets = new SecretsManagerClient({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = process.env.TABLE_NAME;
const secretArn = process.env.ZAPIER_WEBHOOK_SECRET_ARN;
let cachedConfig;
let cachedAt = 0;

const ALLOWED_EVENTS = new Set([
  "IncidentCreated",
  "IncidentUpdated",
  "AlertCreated",
  "AlertUpdated",
  "PodCrashLoopBackOff",
  "NodeNotReady",
  "CpuThresholdExceeded",
  "MemoryPressure",
  "DeploymentUnhealthy",
  "ApiLatencyHigh",
  "serverless.invocation_failed",
  "serverless.invocation_recovered",
  "server.health.failed",
  "server.health.recovered",
]);

async function getConfig() {
  if (!secretArn) throw new Error("ZAPIER_WEBHOOK_SECRET_ARN is not configured.");
  if (cachedConfig && Date.now() - cachedAt < 5 * 60 * 1000) return cachedConfig;

  const response = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const raw = response.SecretString;
  if (!raw) throw new Error("Zapier integration secret has no SecretString.");

  const parsed = JSON.parse(raw);
  if (typeof parsed.webhookUrl !== "string" || !parsed.webhookUrl.startsWith("https://hooks.zapier.com/")) {
    throw new Error("Secret must contain an HTTPS Zapier Catch Hook URL.");
  }
  if (typeof parsed.signingSecret !== "string" || parsed.signingSecret.length < 32) {
    throw new Error("Secret must contain a signingSecret of at least 32 characters.");
  }

  cachedConfig = parsed;
  cachedAt = Date.now();
  return parsed;
}

const EVENT_POLICIES = {
  IncidentCreated: { action: "review-incident", risk: "medium", requiresApproval: false },
  IncidentUpdated: { action: "review-incident-update", risk: "low", requiresApproval: false },
  AlertCreated: { action: "review-alert", risk: "medium", requiresApproval: false },
  AlertUpdated: { action: "review-alert-update", risk: "low", requiresApproval: false },
  PodCrashLoopBackOff: { action: "inspect-pod-crash-loop", risk: "medium", requiresApproval: false },
  NodeNotReady: { action: "inspect-node-readiness", risk: "high", requiresApproval: true },
  CpuThresholdExceeded: { action: "inspect-node-capacity", risk: "medium", requiresApproval: true },
  MemoryPressure: { action: "diagnose-memory-pressure", risk: "low", requiresApproval: false },
  DeploymentUnhealthy: { action: "inspect-deployment", risk: "high", requiresApproval: true },
  ApiLatencyHigh: { action: "inspect-service-latency", risk: "medium", requiresApproval: true },
  "serverless.invocation_failed": { action: "inspect-lambda-error", risk: "low", requiresApproval: false },
  "serverless.invocation_recovered": { action: "none", risk: "low", requiresApproval: false },
  "server.health.failed": { action: "inspect-service-health", risk: "low", requiresApproval: false },
  "server.health.recovered": { action: "none", risk: "low", requiresApproval: false },
};

const NORMALIZED_EVENT_TYPES = {
  IncidentCreated: "incident.created",
  IncidentUpdated: "incident.updated",
  AlertCreated: "alert.created",
  AlertUpdated: "alert.updated",
  PodCrashLoopBackOff: "cluster.health.degraded",
  NodeNotReady: "cluster.health.degraded",
  CpuThresholdExceeded: "cluster.health.degraded",
  MemoryPressure: "cluster.health.degraded",
  DeploymentUnhealthy: "cluster.health.degraded",
  ApiLatencyHigh: "server.health.degraded",
};

function safeString(value, max = 200) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}

export function isCloudWatchAlarmEvent(event) {
  const detail = event?.detail && typeof event.detail === "object" ? event.detail : {};
  const state = detail.state?.value;
  return event?.source === "aws.cloudwatch"
    && event?.["detail-type"] === "CloudWatch Alarm State Change"
    && typeof detail.alarmName === "string"
    && detail.alarmName.startsWith("cloudsentinels-")
    && (state === "ALARM" || state === "OK");
}

function cloudWatchEventType(detail) {
  const alarmName = safeString(detail.alarmName, 128) ?? "";
  const isLambdaAlarm = /(function-errors|processor-errors|worker-errors|relay-errors)/i.test(alarmName);
  if (isLambdaAlarm) {
    return detail.state?.value === "ALARM"
      ? "serverless.invocation_failed"
      : "serverless.invocation_recovered";
  }
  return detail.state?.value === "ALARM" ? "server.health.failed" : "server.health.recovered";
}

export function toPayload(event, storedEvent = {}) {
  const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
  const resource = detail.resource && typeof detail.resource === "object" ? detail.resource : {};
  const cloudWatchAlarm = isCloudWatchAlarmEvent(event);
  const alarmName = cloudWatchAlarm ? safeString(detail.alarmName, 128) : undefined;
  const alarmState = cloudWatchAlarm ? safeString(detail.state?.value, 32) : undefined;
  const previousState = cloudWatchAlarm ? safeString(detail.previousState?.value, 32) : undefined;
  const sourceEventType = safeString(event["detail-type"], 80);
  const policyEventType = cloudWatchAlarm ? cloudWatchEventType(detail) : sourceEventType;
  const eventType = NORMALIZED_EVENT_TYPES[policyEventType] ?? policyEventType;
  const policy = EVENT_POLICIES[policyEventType] ?? EVENT_POLICIES[eventType] ?? {};
  const payload = {
    schemaVersion: "1",
    eventId: safeString(event.id, 128),
    ownerId: safeString(storedEvent.ownerId, 128),
    eventTime: safeString(storedEvent.eventTime, 40),
    eventType,
    sourceEventType,
    source: safeString(event.source, 80),
    sourceType: cloudWatchAlarm ? "aws-cloudwatch" : safeString(detail.sourceType ?? event.source, 80),
    environment: safeString(detail.environment ?? process.env.CLOUDSENTINELS_ENV ?? "aws", 32),
    occurredAt: safeString(event.time, 40),
    severity: cloudWatchAlarm
      ? (alarmState === "ALARM" ? "critical" : "info")
      : safeString(detail.severity ?? detail.priority, 32),
    title: cloudWatchAlarm ? `CloudSentinels alarm: ${alarmName}` : safeString(detail.title, 200),
    summary: cloudWatchAlarm
      ? `CloudWatch alarm state changed from ${previousState ?? "unknown"} to ${alarmState ?? "unknown"}.`
      : safeString(detail.summary, 500),
    incidentId: safeString(
      detail.incidentId ?? (policyEventType?.startsWith("Incident") ? resource.id : undefined),
      128,
    ),
    resourceId: cloudWatchAlarm ? alarmName : safeString(detail.resourceId ?? resource.id, 128),
    clusterRef: safeString(storedEvent.clusterName ?? detail.clusterName ?? detail.clusterArn ?? detail.cluster, 256),
    status: cloudWatchAlarm ? alarmState : safeString(detail.status, 64),
    risk: safeString(storedEvent.risk ?? detail.risk ?? policy.risk, 32),
    recommendedAction: safeString(storedEvent.recommendedAction ?? detail.recommendedAction ?? policy.action, 80),
    requiresApproval: storedEvent.requiresApproval === true || detail.requiresApproval === true || policy.requiresApproval === true,
    recoveryVerified: detail.recoveryVerified === true,
  };
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

async function deliver(event, config) {
  if (typeof event.id !== "string" || !event.id) {
    throw new Error("Automation event is missing its EventBridge id.");
  }

  const cloudWatchAlarm = isCloudWatchAlarmEvent(event);
  let storedEvent = {};
  if (!cloudWatchAlarm) {
    if (!tableName) throw new Error("TABLE_NAME is not configured for the Zapier relay.");
    const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
    const ownerId = safeString(detail.userId, 128);
    const eventTime = safeString(event.time, 40);
    const key = ownerId && eventTime
      ? { PK: `USER#${ownerId}`, SK: `AUTOMATION#${eventTime}#${event.id}` }
      : { PK: "SYSTEM#AUTOMATION", SK: `EVENT#${event.id}` };
    const stored = await db.send(new GetCommand({
      TableName: tableName,
      Key: key,
    }));
    if (!stored.Item) {
      // The processor and relay consume separate SQS queues. Retry the relay until
      // the processor has persisted the authoritative policy decision.
      throw new Error("Automation event record is not ready; retrying before Zapier delivery.");
    }
    storedEvent = stored.Item;
  }
  const payload = toPayload(event, storedEvent);
  const allowlistedSourceType = payload.sourceEventType ?? payload.eventType;
  if (!payload.eventId || !payload.eventType
    || (!ALLOWED_EVENTS.has(allowlistedSourceType) && !ALLOWED_EVENTS.has(payload.eventType))) {
    console.info("Skipping unsupported or malformed event", {
      eventId: payload.eventId ?? "missing",
      eventType: payload.eventType ?? "missing",
    });
    return;
  }

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", config.signingSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const response = await fetch(config.webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cloudsentinels-event-id": payload.eventId,
      "x-cloudsentinels-timestamp": timestamp,
      "x-cloudsentinels-signature": `sha256=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    const responseText = (await response.text()).slice(0, 300);
    throw new Error(`Zapier delivery failed with HTTP ${response.status}: ${responseText}`);
  }

  console.info("Zapier webhook accepted", {
    eventId: payload.eventId,
    eventType: payload.eventType,
    statusCode: response.status,
  });
}

export async function handler(event) {
  const failures = [];
  let config;

  for (const record of event.Records ?? []) {
    try {
      const domainEvent = JSON.parse(record.body ?? "{}");
      if (!ALLOWED_EVENTS.has(domainEvent["detail-type"]) && !isCloudWatchAlarmEvent(domainEvent)) continue;
      config ??= await getConfig();
      await deliver(domainEvent, config);
    } catch (error) {
      console.error("Zapier relay delivery failed", {
        messageId: record.messageId,
        errorName: error?.name ?? "Error",
        message: String(error?.message ?? "Unknown error").slice(0, 300),
      });
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}
