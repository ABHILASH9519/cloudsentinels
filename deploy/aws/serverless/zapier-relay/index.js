import { createHmac } from "node:crypto";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const secrets = new SecretsManagerClient({});
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
  PodCrashLoopBackOff: { action: "restart-pod", risk: "medium", requiresApproval: false },
  NodeNotReady: { action: "replace-or-recover-node", risk: "high", requiresApproval: true },
  CpuThresholdExceeded: { action: "scale-workload", risk: "medium", requiresApproval: true },
  MemoryPressure: { action: "diagnose-memory-pressure", risk: "low", requiresApproval: false },
  DeploymentUnhealthy: { action: "rollback-deployment", risk: "high", requiresApproval: true },
  ApiLatencyHigh: { action: "scale-or-investigate-service", risk: "medium", requiresApproval: true },
};

function safeString(value, max = 200) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}

function toPayload(event) {
  const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
  const resource = detail.resource && typeof detail.resource === "object" ? detail.resource : {};
  const eventType = safeString(event["detail-type"], 80);
  const policy = EVENT_POLICIES[eventType] ?? {};
  const payload = {
    schemaVersion: "1",
    eventId: safeString(event.id, 128),
    eventType,
    source: safeString(event.source, 80),
    occurredAt: safeString(event.time, 40),
    severity: safeString(detail.severity ?? detail.priority, 32),
    incidentId: safeString(detail.incidentId ?? resource.id ?? detail.resourceId, 128),
    clusterRef: safeString(detail.clusterName ?? detail.cluster, 128),
    status: safeString(detail.status, 64),
    risk: safeString(detail.risk ?? policy.risk, 32),
    recommendedAction: safeString(detail.recommendedAction ?? policy.action, 80),
    requiresApproval: detail.requiresApproval === true || policy.requiresApproval === true,
    recoveryVerified: detail.recoveryVerified === true,
  };
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

async function deliver(event, config) {
  const payload = toPayload(event);
  if (!payload.eventId || !payload.eventType || !ALLOWED_EVENTS.has(payload.eventType)) {
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
      if (!ALLOWED_EVENTS.has(domainEvent["detail-type"])) continue;
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
