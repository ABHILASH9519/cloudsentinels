import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const tableName = process.env.TABLE_NAME;
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// This coordinator is deliberately non-destructive. It records and classifies
// events; it does not call Kubernetes APIs until a cluster adapter, target,
// RBAC grant, and approval policy have been configured.
const remediationRules = {
  PodCrashLoopBackOff: {
    action: "restart-pod",
    risk: "medium",
    requiresApproval: false,
  },
  NodeNotReady: {
    action: "replace-or-recover-node",
    risk: "high",
    requiresApproval: true,
  },
  CpuThresholdExceeded: {
    action: "scale-workload",
    risk: "medium",
    requiresApproval: true,
  },
  MemoryPressure: {
    action: "diagnose-memory-pressure",
    risk: "low",
    requiresApproval: false,
  },
  DeploymentUnhealthy: {
    action: "rollback-deployment",
    risk: "high",
    requiresApproval: true,
  },
  ApiLatencyHigh: {
    action: "scale-or-investigate-service",
    risk: "medium",
    requiresApproval: true,
  },
};

export function classifyEvent(domainEvent) {
  const rawEventType = domainEvent["detail-type"];
  const eventType = typeof rawEventType === "string" && rawEventType
    ? rawEventType.slice(0, 80)
    : "Unknown";
  const detail = domainEvent.detail && typeof domainEvent.detail === "object"
    ? domainEvent.detail
    : {};
  const rule = Object.hasOwn(remediationRules, rawEventType)
    ? remediationRules[rawEventType]
    : undefined;
  if (!rule) {
    return {
      eventType,
      status: "OBSERVED",
      recommendedAction: null,
      risk: "informational",
      requiresApproval: false,
      reason: "No remediation rule is configured for this event type.",
      clusterName: null,
    };
  }

  const rawClusterName = detail.clusterName ?? detail.clusterArn ?? detail.cluster ?? null;
  const clusterName = typeof rawClusterName === "string" && rawClusterName.trim()
    ? rawClusterName.trim().slice(0, 256)
    : null;
  if (!clusterName) {
    return {
      eventType,
      status: "BLOCKED_NO_CLUSTER_TARGET",
      recommendedAction: rule.action,
      risk: rule.risk,
      requiresApproval: rule.requiresApproval,
      reason: "The event does not identify a registered Kubernetes cluster target.",
      clusterName: null,
    };
  }

  return {
    eventType,
    status: rule.requiresApproval ? "PENDING_APPROVAL" : "PENDING_CLUSTER_ADAPTER",
    recommendedAction: rule.action,
    risk: rule.risk,
    requiresApproval: rule.requiresApproval,
    reason: rule.requiresApproval
      ? "A cluster target is present, but this action requires an explicit approval workflow."
      : "A cluster target is present, but no Kubernetes remediation adapter is enabled.",
    clusterName,
  };
}


// Procedures are data-driven records in the existing DynamoDB table:
// PK = SYSTEM#PROCEDURES, SK = PROCEDURE#<eventType>#<zero-padded-version>.
// Dynamic records can select only adapter actions that the execution layer
// explicitly supports. Adding a procedure never grants arbitrary code execution.
const ALLOWED_ACTIONS = new Set([
  "restart-pod",
  "replace-or-recover-node",
  "scale-workload",
  "diagnose-memory-pressure",
  "rollback-deployment",
  "scale-or-investigate-service",
]);
const ALLOWED_RISKS = new Set(["low", "medium", "high", "critical"]);

function clusterTarget(detail) {
  const raw = detail.clusterName ?? detail.clusterArn ?? detail.cluster ?? null;
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 256) : null;
}

export async function resolveProcedure(domainEvent) {
  const classification = classifyEvent(domainEvent);
  const detail = domainEvent.detail && typeof domainEvent.detail === "object"
    ? domainEvent.detail
    : {};
  const target = clusterTarget(detail);
  if (!tableName || classification.eventType === "Unknown") return classification;

  const result = await db.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    ExpressionAttributeValues: {
      ":pk": "SYSTEM#PROCEDURES",
      ":prefix": `PROCEDURE#${classification.eventType}#`,
    },
    ScanIndexForward: false,
    Limit: 1,
  }));
  const procedure = (result.Items ?? [])[0];
  if (!procedure) return { ...classification, clusterName: target };

  if (procedure.enabled === false) {
    return {
      ...classification,
      status: "OBSERVED",
      recommendedAction: null,
      risk: "informational",
      requiresApproval: false,
      reason: "The matching procedure is disabled in the procedure registry.",
      clusterName: target,
      procedureId: procedure.procedureId ?? null,
      procedureVersion: procedure.version ?? null,
    };
  }

  if (
    typeof procedure.action !== "string" ||
    !ALLOWED_ACTIONS.has(procedure.action) ||
    !ALLOWED_RISKS.has(procedure.risk) ||
    typeof procedure.requiresApproval !== "boolean"
  ) {
    return {
      ...classification,
      status: "BLOCKED_INVALID_PROCEDURE",
      recommendedAction: null,
      risk: "high",
      requiresApproval: true,
      reason: "The matching procedure is malformed or requests an unsupported action.",
      clusterName: target,
      procedureId: procedure.procedureId ?? null,
      procedureVersion: procedure.version ?? null,
    };
  }

  if (!target) {
    return {
      ...classification,
      status: "BLOCKED_NO_CLUSTER_TARGET",
      recommendedAction: procedure.action,
      risk: procedure.risk,
      requiresApproval: procedure.requiresApproval,
      reason: "The event does not identify a registered Kubernetes cluster target.",
      clusterName: null,
      procedureId: procedure.procedureId ?? null,
      procedureVersion: procedure.version ?? null,
    };
  }

  return {
    ...classification,
    status: procedure.requiresApproval ? "PENDING_APPROVAL" : "PENDING_CLUSTER_ADAPTER",
    recommendedAction: procedure.action,
    risk: procedure.risk,
    requiresApproval: procedure.requiresApproval,
    reason: procedure.requiresApproval
      ? "A matching versioned procedure requires explicit approval."
      : "A matching procedure is available; execution still requires an enabled cluster adapter.",
    clusterName: target,
    procedureId: procedure.procedureId ?? null,
    procedureVersion: procedure.version ?? null,
  };
}

async function recordEvent(domainEvent) {
  if (!tableName) throw new Error("TABLE_NAME is not configured.");
  if (!domainEvent || typeof domainEvent.id !== "string" || !domainEvent.id.trim()) {
    throw new Error("The EventBridge message is missing its event id.");
  }
  if (domainEvent.id.length > 128) {
    throw new Error("The EventBridge event id exceeds the 128-character limit.");
  }

  const classification = classifyEvent(domainEvent);
  const now = new Date().toISOString();
  const item = {
    PK: "SYSTEM#AUTOMATION",
    SK: `EVENT#${domainEvent.id}`,
    id: domainEvent.id,
    source: typeof domainEvent.source === "string"
      ? domainEvent.source.slice(0, 128)
      : "unknown",
    eventType: classification.eventType,
    eventTime: typeof domainEvent.time === "string" && domainEvent.time.length <= 40
      ? domainEvent.time
      : now,
    createdAt: now,
    status: classification.status,
    recommendedAction: classification.recommendedAction,
    procedureId: classification.procedureId ?? null,
    procedureVersion: classification.procedureVersion ?? null,
    risk: classification.risk,
    requiresApproval: classification.requiresApproval,
    clusterName: classification.clusterName,
    reason: classification.reason,
    recoveryVerified: false,
  };

  try {
    await db.send(new PutCommand({
      TableName: tableName,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    }));
    console.info("Automation event classified", {
      eventId: item.id,
      eventType: item.eventType,
      status: item.status,
    });
  } catch (error) {
    if (error?.name === "ConditionalCheckFailedException") {
      console.info("Duplicate automation event ignored", { eventId: item.id });
      return;
    }
    throw error;
  }
}

export async function handler(event) {
  const batchItemFailures = [];
  for (const record of event.Records ?? []) {
    try {
      const domainEvent = JSON.parse(record.body ?? "{}");
      await recordEvent(domainEvent);
    } catch (error) {
      console.error("Automation event processing failed", {
        messageId: record.messageId,
        errorName: error?.name ?? "Error",
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
