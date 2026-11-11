import test from "node:test";
import assert from "node:assert/strict";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

process.env.TABLE_NAME = "cloudsentinels-remediation-test";
process.env.REMEDIATION_ADAPTER_FUNCTION_ARN = "arn:aws:lambda:ap-south-1:123456789012:function:test-adapter";
const { handler } = await import("./index.js");
const originalLambdaSend = LambdaClient.prototype.send;
const originalDbSend = DynamoDBDocumentClient.prototype.send;

let eventRecord;
let invocations;
let updates;
let adapterResponse;

function resetState() {
  eventRecord = {
    PK: "USER#user-123",
    SK: "AUTOMATION#2026-11-10T10:00:00.000Z#event-123",
    id: "event-123",
    ownerId: "user-123",
    eventTime: "2026-11-10T10:00:00.000Z",
    status: "APPROVED_AWAITING_EXECUTOR",
    commandId: "command-abc",
    recommendedAction: "rollback-deployment",
    clusterName: "staging-cluster",
    requiresApproval: true,
  };
  invocations = [];
  updates = [];
  adapterResponse = {
    accepted: true,
    executionId: "execution-123",
    recoveryVerified: false,
  };
}

DynamoDBDocumentClient.prototype.send = async function (command) {
  if (command.constructor.name === "GetCommand") return { Item: eventRecord };
  if (command.constructor.name === "UpdateCommand") {
    updates.push(command.input);
    const values = command.input.ExpressionAttributeValues;
    eventRecord = {
      ...eventRecord,
      status: values[":status"],
      ...Object.fromEntries(
        Object.entries(values)
          .filter(([key]) => ![":status", ":updatedAt", ":commandId"].includes(key))
          .map(([key, value]) => [key.slice(1), value]),
      ),
    };
    return {};
  }
  throw new Error(`Unexpected DynamoDB command: ${command.constructor.name}`);
};

LambdaClient.prototype.send = async function (command) {
  invocations.push(command.input);
  return { Payload: Buffer.from(JSON.stringify(adapterResponse)) };
};

function queueEvent(overrides = {}) {
  return {
    Records: [{
      messageId: "sqs-message-1",
      body: JSON.stringify({
        source: "cloudsentinels.zapier",
        "detail-type": "RemediationCommandApproved",
        detail: {
          eventId: "event-123",
          eventTime: "2026-11-10T10:00:00.000Z",
          ownerId: "user-123",
          commandId: "command-abc",
          action: "rollback-deployment",
          clusterName: "staging-cluster",
          approvedBy: "zapier-approval-step",
          approvedAt: "2026-11-10T10:00:00.000Z",
          requiresApproval: true,
          ...overrides,
        },
      }),
    }],
  };
}

test.beforeEach(resetState);
test.after(() => {
  LambdaClient.prototype.send = originalLambdaSend;
  DynamoDBDocumentClient.prototype.send = originalDbSend;
});

test("dispatches an approved command to the configured adapter", async () => {
  const result = await handler(queueEvent());

  assert.deepEqual(result, { batchItemFailures: [] });
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].FunctionName, process.env.REMEDIATION_ADAPTER_FUNCTION_ARN);
  assert.equal(updates.length, 2);
  assert.equal(eventRecord.status, "ACTION_SUBMITTED_UNVERIFIED");
  assert.equal(eventRecord.recoveryVerified, false);
});

test("records verified recovery only when the adapter explicitly confirms it", async () => {
  adapterResponse.recoveryVerified = true;
  const result = await handler(queueEvent());

  assert.deepEqual(result, { batchItemFailures: [] });
  assert.equal(eventRecord.status, "RECOVERY_VERIFIED");
  assert.equal(eventRecord.recoveryVerified, true);
});

test("does not dispatch an event that is not approved", async () => {
  eventRecord.status = "PENDING_APPROVAL";
  const result = await handler(queueEvent());

  assert.deepEqual(result, {
    batchItemFailures: [{ itemIdentifier: "sqs-message-1" }],
  });
  assert.equal(invocations.length, 0);
});

test("does not dispatch when the approved action does not match the event", async () => {
  const result = await handler(queueEvent({ action: "restart-pod" }));

  assert.deepEqual(result, {
    batchItemFailures: [{ itemIdentifier: "sqs-message-1" }],
  });
  assert.equal(invocations.length, 0);
});

test("does not repeat an already completed command", async () => {
  eventRecord.status = "RECOVERY_VERIFIED";
  const result = await handler(queueEvent());

  assert.deepEqual(result, { batchItemFailures: [] });
  assert.equal(invocations.length, 0);
  assert.equal(updates.length, 0);
});

test("records adapter failures and retries the same approved command", async () => {
  adapterResponse = { accepted: false };
  const first = await handler(queueEvent());

  assert.deepEqual(first, {
    batchItemFailures: [{ itemIdentifier: "sqs-message-1" }],
  });
  assert.equal(eventRecord.status, "EXECUTION_FAILED");

  adapterResponse = {
    accepted: true,
    executionId: "execution-retry",
    recoveryVerified: true,
  };
  const second = await handler(queueEvent());

  assert.deepEqual(second, { batchItemFailures: [] });
  assert.equal(invocations.length, 2);
  assert.equal(eventRecord.status, "RECOVERY_VERIFIED");
});

test("dispatches a low-risk action when the stored policy says approval is not required", async () => {
  eventRecord.requiresApproval = false;
  const result = await handler(queueEvent({ requiresApproval: false }));

  assert.deepEqual(result, { batchItemFailures: [] });
  assert.equal(invocations.length, 1);
  assert.equal(eventRecord.status, "ACTION_SUBMITTED_UNVERIFIED");
});

test("rejects a command whose approval flag differs from the stored event", async () => {
  const result = await handler(queueEvent({ requiresApproval: false }));

  assert.deepEqual(result, {
    batchItemFailures: [{ itemIdentifier: "sqs-message-1" }],
  });
  assert.equal(invocations.length, 0);
});
