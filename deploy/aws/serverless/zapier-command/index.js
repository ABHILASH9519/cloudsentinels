import { createHmac, timingSafeEqual } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eventBridge = new EventBridgeClient({});
const secrets = new SecretsManagerClient({});
const tableName = process.env.TABLE_NAME;
const eventBusName = process.env.EVENT_BUS_NAME;
const secretArn = process.env.ZAPIER_COMMAND_SECRET_ARN;
const MAX_CLOCK_SKEW_SECONDS = 300;
const ALLOWED_ACTIONS = new Set([
  "restart-pod",
  "replace-or-recover-node",
  "scale-workload",
  "diagnose-memory-pressure",
  "rollback-deployment",
  "scale-or-investigate-service",
]);

let cachedSecret;
let cachedAt = 0;

const response = (statusCode, body) => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store",
  },
  body: JSON.stringify(body),
});

function header(event, name) {
  const headers = event.headers ?? {};
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

function rawBody(event) {
  const body = event.body ?? "";
  return event.isBase64Encoded
    ? Buffer.from(body, "base64").toString("utf8")
    : body;
}

async function getSigningSecret() {
  if (!secretArn) throw new Error("ZAPIER_COMMAND_SECRET_ARN is not configured.");
  if (cachedSecret && Date.now() - cachedAt < 5 * 60 * 1000) return cachedSecret;

  const result = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!result.SecretString) throw new Error("Zapier command secret is empty.");
  const parsed = JSON.parse(result.SecretString);
  if (typeof parsed.signingSecret !== "string" || parsed.signingSecret.length < 32) {
    throw new Error("Zapier command signing secret must contain at least 32 characters.");
  }
  cachedSecret = parsed.signingSecret;
  cachedAt = Date.now();
  return cachedSecret;
}

async function verifySignature(event, body) {
  const timestamp = header(event, "x-cloudsentinels-timestamp");
  const supplied = header(event, "x-cloudsentinels-signature");
  if (typeof timestamp !== "string" || !/^\d{10}$/.test(timestamp)) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (age > MAX_CLOCK_SKEW_SECONDS) return false;
  if (typeof supplied !== "string" || !/^sha256=[a-f0-9]{64}$/.test(supplied)) return false;

  const secret = await getSigningSecret();
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest();
  const actual = Buffer.from(supplied.slice("sha256=".length), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function validateCommand(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "Request body must be a JSON object.";
  }
  const fields = [
    ["eventId", 128],
    ["commandId", 128],
    ["action", 80],
    ["approvedBy", 128],
  ];
  for (const [field, max] of fields) {
    if (typeof value[field] !== "string" || !value[field].trim() || value[field].length > max) {
      return `${field} is required and must be at most ${max} characters.`;
    }
  }
  if (!ALLOWED_ACTIONS.has(value.action)) return "Requested action is not allow-listed.";
  if (value.approvalStatus !== "approved") return "An explicit approved status is required.";
  return null;
}

async function publishApprovedCommand(command, eventRecord) {
  const result = await eventBridge.send(new PutEventsCommand({
    Entries: [{
      EventBusName: eventBusName,
      Source: "cloudsentinels.zapier",
      DetailType: "RemediationCommandApproved",
      Time: new Date(),
      Detail: JSON.stringify({
        eventId: command.eventId,
        commandId: command.commandId,
        action: command.action,
        clusterName: eventRecord.clusterName,
        approvedBy: command.approvedBy,
        approvedAt: new Date().toISOString(),
        requiresApproval: eventRecord.requiresApproval === true,
        risk: eventRecord.risk ?? "unknown",
      }),
    }],
  }));
  if ((result.FailedEntryCount ?? 0) > 0) {
    throw new Error("EventBridge did not accept the remediation command.");
  }
}

export async function handler(event) {
  if ((event.requestContext?.http?.method ?? "POST") !== "POST") {
    return response(405, { error: "Method not allowed." });
  }
  const body = rawBody(event);
  if (body.length > 8192) return response(413, { error: "Request body is too large." });
  if (!body) return response(400, { error: "Request body is required." });

  try {
    if (!await verifySignature(event, body)) {
      return response(401, { error: "Invalid or expired Zapier signature." });
    }
    let command;
    try {
      command = JSON.parse(body);
    } catch {
      return response(400, { error: "Request body must be valid JSON." });
    }
    const validationError = validateCommand(command);
    if (validationError) return response(400, { error: validationError });
    if (!tableName || !eventBusName) throw new Error("AWS command receiver configuration is incomplete.");

    const key = { PK: "SYSTEM#AUTOMATION", SK: `EVENT#${command.eventId}` };
    const result = await db.send(new GetCommand({ TableName: tableName, Key: key }));
    const record = result.Item;
    if (!record) return response(404, { error: "Automation event was not found." });
    if (
      typeof record.requiresApproval !== "boolean" ||
      record.recommendedAction !== command.action
    ) {
      return response(409, { error: "Command does not match the event's stored remediation policy." });
    }
    if (record.requiresApproval && command.approvedBy.toLowerCase() === "zapier-auto-policy") {
      return response(403, { error: "This high-risk action requires a human approval identity." });
    }
    if (typeof record.clusterName !== "string" || !record.clusterName) {
      return response(409, { error: "Event has no registered cluster target." });
    }

    const pendingStatus = record.requiresApproval
      ? "PENDING_APPROVAL"
      : "PENDING_CLUSTER_ADAPTER";
    if (record.status === pendingStatus) {
      await db.send(new UpdateCommand({
        TableName: tableName,
        Key: key,
        UpdateExpression: "SET #status = :approved, commandId = :commandId, approvedBy = :approvedBy, approvedAt = :approvedAt",
        ConditionExpression: "#status = :pending AND requiresApproval = :requiresApproval AND recommendedAction = :action",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":approved": "APPROVED_AWAITING_EXECUTOR",
          ":pending": pendingStatus,
          ":requiresApproval": record.requiresApproval,
          ":action": command.action,
          ":commandId": command.commandId,
          ":approvedBy": command.approvedBy.slice(0, 128),
          ":approvedAt": new Date().toISOString(),
        },
      }));
    } else if (record.status !== "APPROVED_AWAITING_EXECUTOR" || record.commandId !== command.commandId) {
      return response(409, { error: "Event is not awaiting this approval command." });
    }

    await publishApprovedCommand(command, record);
    return response(202, {
      accepted: true,
      eventId: command.eventId,
      commandId: command.commandId,
      status: "APPROVED_AWAITING_EXECUTOR",
      execution: "queued-for-policy-gated-worker",
    });
  } catch (error) {
    console.error("Zapier remediation command rejected", {
      errorName: error?.name ?? "Error",
      message: String(error?.message ?? "Unknown error").slice(0, 200),
    });
    return response(503, { error: "The remediation command could not be processed. Retry with the same commandId." });
  }
}
