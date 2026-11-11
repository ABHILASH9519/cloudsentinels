import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

process.env.TABLE_NAME = "cloudsentinels-command-test";
process.env.EVENT_BUS_NAME = "cloudsentinels-test-bus";
process.env.ZAPIER_COMMAND_SECRET_ARN = "arn:aws:secretsmanager:ap-south-1:123456789012:secret:zapier-command-test";
process.env.REMEDIATION_EXECUTION_ENABLED = "true";
process.env.REMEDIATION_ADAPTER_FUNCTION_ARN = "arn:aws:lambda:ap-south-1:123456789012:function:test-adapter";

const signingSecret = "a-test-signing-secret-that-is-long-enough-for-hmac";
const { handler } = await import("./index.js");
const originalDbSend = DynamoDBDocumentClient.prototype.send;
const originalEventSend = EventBridgeClient.prototype.send;
const originalSecretSend = SecretsManagerClient.prototype.send;

let record;
let updates;
let published;
let secretReads;
let requestedKey;

function resetState() {
  record = {
    PK: "USER#user-123",
    SK: "AUTOMATION#2026-11-10T10:00:00.000Z#event-123",
    id: "event-123",
    ownerId: "user-123",
    eventTime: "2026-11-10T10:00:00.000Z",
    status: "PENDING_APPROVAL",
    requiresApproval: true,
    recommendedAction: "rollback-deployment",
    clusterName: "staging-cluster",
  };
  updates = [];
  published = [];
  secretReads = 0;
  requestedKey = undefined;
}

DynamoDBDocumentClient.prototype.send = async function (command) {
  if (command.constructor.name === "GetCommand") {
    requestedKey = command.input.Key;
    return { Item: record };
  }
  if (command.constructor.name === "UpdateCommand") {
    updates.push(command.input);
    record = {
      ...record,
      status: command.input.ExpressionAttributeValues[":approved"],
      commandId: command.input.ExpressionAttributeValues[":commandId"],
    };
    return {};
  }
  throw new Error(`Unexpected DynamoDB command: ${command.constructor.name}`);
};

EventBridgeClient.prototype.send = async function (command) {
  published.push(command.input);
  return { FailedEntryCount: 0, Entries: [{ EventId: "published-event" }] };
};

SecretsManagerClient.prototype.send = async function () {
  secretReads += 1;
  return { SecretString: JSON.stringify({ signingSecret }) };
};

function signedRequest(overrides = {}, { timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const body = JSON.stringify({
    eventId: "event-123",
    eventTime: "2026-11-10T10:00:00.000Z",
    ownerId: "user-123",
    commandId: "command-abc",
    action: "rollback-deployment",
    approvalStatus: "approved",
    approvedBy: "zapier-approval-step",
    ...overrides,
  });
  const signature = createHmac("sha256", signingSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return {
    requestContext: { http: { method: "POST" } },
    headers: {
      "x-cloudsentinels-timestamp": String(timestamp),
      "x-cloudsentinels-signature": `sha256=${signature}`,
    },
    body,
  };
}

test.beforeEach(resetState);
test.after(() => {
  DynamoDBDocumentClient.prototype.send = originalDbSend;
  EventBridgeClient.prototype.send = originalEventSend;
  SecretsManagerClient.prototype.send = originalSecretSend;
});

test("accepts a signed approval for a matching pending remediation", async () => {
  const result = await handler(signedRequest());

  assert.equal(result.statusCode, 202);
  assert.equal(JSON.parse(result.body).status, "APPROVED_AWAITING_EXECUTOR");
  assert.equal(record.status, "APPROVED_AWAITING_EXECUTOR");
  assert.equal(record.commandId, "command-abc");
  assert.equal(updates.length, 1);
  assert.deepEqual(requestedKey, {
    PK: "USER#user-123",
    SK: "AUTOMATION#2026-11-10T10:00:00.000Z#event-123",
  });
  assert.equal(published.length, 1);
  assert.equal(published[0].Entries[0].Source, "cloudsentinels.zapier");
  assert.equal(published[0].Entries[0].DetailType, "RemediationCommandApproved");
  const approvedDetail = JSON.parse(published[0].Entries[0].Detail);
  assert.equal(approvedDetail.ownerId, "user-123");
  assert.equal(approvedDetail.eventTime, "2026-11-10T10:00:00.000Z");
});

test("rejects an invalid HMAC without reading or changing an event", async () => {
  const request = signedRequest();
  request.headers["x-cloudsentinels-signature"] = `sha256=${"0".repeat(64)}`;
  const result = await handler(request);

  assert.equal(result.statusCode, 401);
  assert.equal(updates.length, 0);
  assert.equal(published.length, 0);
});

test("rejects expired signatures", async () => {
  const oldTimestamp = Math.floor(Date.now() / 1000) - 301;
  const result = await handler(signedRequest({}, { timestamp: oldTimestamp }));

  assert.equal(result.statusCode, 401);
  assert.equal(secretReads, 0);
  assert.equal(updates.length, 0);
});

test("rejects an action that does not match the pending event", async () => {
  const result = await handler(signedRequest({ action: "restart-pod" }));

  assert.equal(result.statusCode, 409);
  assert.equal(updates.length, 0);
  assert.equal(published.length, 0);
});

test("does not apply a second command id to an already approved event", async () => {
  record.status = "APPROVED_AWAITING_EXECUTOR";
  record.commandId = "first-command";

  const result = await handler(signedRequest({ commandId: "second-command" }));

  assert.equal(result.statusCode, 409);
  assert.equal(updates.length, 0);
  assert.equal(published.length, 0);
});

test("retries publishing the same accepted command without repeating the state transition", async () => {
  record.status = "APPROVED_AWAITING_EXECUTOR";
  record.commandId = "command-abc";

  const result = await handler(signedRequest());

  assert.equal(result.statusCode, 202);
  assert.equal(updates.length, 0);
  assert.equal(published.length, 1);
});

test("rejects requests without an explicit approval marker", async () => {
  const result = await handler(signedRequest({ approvalStatus: "pending" }));

  assert.equal(result.statusCode, 400);
  assert.equal(updates.length, 0);
  assert.equal(published.length, 0);
});

test("accepts a policy-approved low-risk command without a human approval identity", async () => {
  record.requiresApproval = false;
  record.status = "PENDING_CLUSTER_ADAPTER";
  record.recommendedAction = "restart-pod";

  const result = await handler(signedRequest({
    action: "restart-pod",
    approvedBy: "zapier-auto-policy",
  }));

  assert.equal(result.statusCode, 202);
  assert.equal(record.status, "APPROVED_AWAITING_EXECUTOR");
  assert.equal(updates.length, 1);
  const detail = JSON.parse(published[0].Entries[0].Detail);
  assert.equal(detail.requiresApproval, false);
});

test("requires a human approval identity for high-risk commands", async () => {
  const result = await handler(signedRequest({ approvedBy: "zapier-auto-policy" }));

  assert.equal(result.statusCode, 403);
  assert.equal(updates.length, 0);
  assert.equal(published.length, 0);
});

test("does not accept approval commands while remediation execution is disabled", async (t) => {
  const enabled = process.env.REMEDIATION_EXECUTION_ENABLED;
  process.env.REMEDIATION_EXECUTION_ENABLED = "false";
  t.after(() => { process.env.REMEDIATION_EXECUTION_ENABLED = enabled; });
  const result = await handler(signedRequest());
  assert.equal(result.statusCode, 503);
  assert.equal(updates.length, 0);
  assert.equal(published.length, 0);
});
