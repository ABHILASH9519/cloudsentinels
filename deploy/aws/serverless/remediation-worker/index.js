import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const lambda = new LambdaClient({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = process.env.TABLE_NAME;
const adapterFunctionArn = process.env.REMEDIATION_ADAPTER_FUNCTION_ARN;

const ALLOWED_ACTIONS = new Set([
  "restart-pod",
  "replace-or-recover-node",
  "scale-workload",
  "diagnose-memory-pressure",
  "rollback-deployment",
  "scale-or-investigate-service",
]);

function parseRecord(record) {
  const event = JSON.parse(record.body ?? "{}");
  const detail = event.detail;
  if (
    event.source !== "cloudsentinels.zapier" ||
    event["detail-type"] !== "RemediationCommandApproved" ||
    !detail ||
    typeof detail !== "object"
  ) {
    throw new Error("Unsupported remediation queue message.");
  }
  for (const field of ["eventId", "commandId", "action", "clusterName", "approvedBy"]) {
    if (typeof detail[field] !== "string" || !detail[field].trim()) {
      throw new Error(`Remediation command is missing ${field}.`);
    }
  }
  if (typeof detail.requiresApproval !== "boolean") {
    throw new Error("Remediation command is missing its approval policy flag.");
  }
  if (!ALLOWED_ACTIONS.has(detail.action)) throw new Error("Remediation action is not allow-listed.");
  return detail;
}

async function setStatus(key, commandId, status, extra = {}) {
  await db.send(new UpdateCommand({
    TableName: tableName,
    Key: key,
    UpdateExpression: "SET #status = :status, updatedAt = :updatedAt" +
      Object.keys(extra).map((field) => `, ${field} = :${field}`).join(""),
    ConditionExpression: "commandId = :commandId",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: {
      ":status": status,
      ":updatedAt": new Date().toISOString(),
      ":commandId": commandId,
      ...Object.fromEntries(Object.entries(extra).map(([field, value]) => [`:${field}`, value])),
    },
  }));
}

async function execute(detail) {
  if (!tableName || !adapterFunctionArn) {
    throw new Error("Remediation worker is missing its table or adapter configuration.");
  }

  const key = { PK: "SYSTEM#AUTOMATION", SK: `EVENT#${detail.eventId}` };
  const result = await db.send(new GetCommand({ TableName: tableName, Key: key }));
  const eventRecord = result.Item;
  if (
    !eventRecord ||
    eventRecord.commandId !== detail.commandId ||
    eventRecord.recommendedAction !== detail.action ||
    eventRecord.clusterName !== detail.clusterName ||
    eventRecord.requiresApproval !== detail.requiresApproval
  ) {
    throw new Error("Remediation command no longer matches an approved event record.");
  }
  if (["RECOVERY_VERIFIED", "ACTION_SUBMITTED_UNVERIFIED"].includes(eventRecord.status)) {
    return;
  }
  if (!["APPROVED_AWAITING_EXECUTOR", "EXECUTING", "EXECUTION_FAILED"].includes(eventRecord.status)) {
    throw new Error("Remediation event is not in an executable state.");
  }

  if (eventRecord.status === "APPROVED_AWAITING_EXECUTOR") {
    await setStatus(key, detail.commandId, "EXECUTING", {
      executionStartedAt: new Date().toISOString(),
    });
  }

  let adapterResult;
  try {
    const invocation = await lambda.send(new InvokeCommand({
      FunctionName: adapterFunctionArn,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify({
        schemaVersion: "1",
        commandId: detail.commandId,
        eventId: detail.eventId,
        action: detail.action,
        clusterName: detail.clusterName,
        approvedBy: detail.approvedBy,
        approvedAt: detail.approvedAt,
      })),
    }));

    if (invocation.FunctionError) {
      const message = Buffer.from(invocation.Payload ?? []).toString("utf8").slice(0, 500);
      throw new Error(`Remediation adapter failed: ${message}`);
    }

    try {
      adapterResult = JSON.parse(Buffer.from(invocation.Payload ?? []).toString("utf8"));
    } catch {
      throw new Error("Remediation adapter returned invalid JSON.");
    }
    if (adapterResult.accepted !== true) {
      throw new Error("Remediation adapter did not accept the command.");
    }
  } catch (error) {
    await setStatus(key, detail.commandId, "EXECUTION_FAILED", {
      executionFailedAt: new Date().toISOString(),
      lastExecutionError: String(error?.message ?? "Adapter failure").slice(0, 300),
    });
    throw error;
  }

  const recoveryVerified = adapterResult.recoveryVerified === true;
  await setStatus(
    key,
    detail.commandId,
    recoveryVerified ? "RECOVERY_VERIFIED" : "ACTION_SUBMITTED_UNVERIFIED",
    {
      recoveryVerified,
      adapterExecutionId: typeof adapterResult.executionId === "string"
        ? adapterResult.executionId.slice(0, 128)
        : "unknown",
      executionCompletedAt: new Date().toISOString(),
    },
  );
  console.info("Approved remediation dispatched", {
    eventId: detail.eventId,
    commandId: detail.commandId,
    action: detail.action,
    recoveryVerified,
  });
}

export async function handler(event) {
  const batchItemFailures = [];
  for (const record of event.Records ?? []) {
    try {
      const detail = parseRecord(record);
      await execute(detail);
    } catch (error) {
      console.error("Remediation command execution failed", {
        messageId: record.messageId,
        errorName: error?.name ?? "Error",
        message: String(error?.message ?? "Unknown error").slice(0, 300),
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
