import test from "node:test";
import assert from "node:assert/strict";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

process.env.TABLE_NAME = "cloudsentinels-test-table";
process.env.AUTOMATION_OWNER_ID = "firebase-test-owner";
const { classifyAwsEvent, handler } = await import("./index.js");

test("records EC2 state changes without automatically starting or stopping instances", () => {
  const result = classifyAwsEvent({
    source: "aws.ec2",
    "detail-type": "EC2 Instance State-change Notification",
    detail: { "instance-id": "i-0123456789abcdef0", state: "stopped" },
  });
  assert.equal(result.eventType, "EC2InstanceStateChanged");
  assert.equal(result.resourceId, "i-0123456789abcdef0");
  assert.equal(result.resourceState, "stopped");
  assert.equal(result.severity, "medium");
  assert.equal(result.status, "OBSERVED");
  assert.equal(result.recommendedAction, null);
  assert.match(result.reason, /never starts, stops, or terminates/i);
});

test("requires operator review for an active CloudWatch alarm", () => {
  const result = classifyAwsEvent({
    source: "aws.cloudwatch",
    "detail-type": "CloudWatch Alarm State Change",
    detail: { alarmName: "cloudsentinels-lambda-operations-errors", state: { value: "ALARM" } },
  });
  assert.equal(result.eventType, "CloudWatchAlarmStateChanged");
  assert.equal(result.status, "PENDING_APPROVAL");
  assert.equal(result.requiresApproval, true);
  assert.equal(result.risk, "critical");
  assert.equal(result.severity, "critical");
  assert.equal(result.recommendedAction, null);
});

test("marks recovered CloudWatch alarms as observed", () => {
  const result = classifyAwsEvent({
    source: "aws.cloudwatch",
    "detail-type": "CloudWatch Alarm State Change",
    detail: { alarmName: "cloudsentinels-lambda-duration", state: { value: "OK" } },
  });
  assert.equal(result.status, "OBSERVED");
  assert.equal(result.requiresApproval, false);
  assert.equal(result.severity, "low");
});

test("unknown AWS event types remain observe-only", () => {
  const result = classifyAwsEvent({ source: "aws.ec2", "detail-type": "UnexpectedSignal", detail: {} });
  assert.equal(result.status, "OBSERVED");
  assert.equal(result.recommendedAction, null);
});

test("writes events into the authenticated owner's automation activity partition", async (t) => {
  const originalSend = DynamoDBDocumentClient.prototype.send;
  let stored;
  DynamoDBDocumentClient.prototype.send = async function (command) {
    stored = command.input;
    return {};
  };
  t.after(() => { DynamoDBDocumentClient.prototype.send = originalSend; });

  const response = await handler({
    Records: [{
      messageId: "sqs-1",
      body: JSON.stringify({
        id: "event-123",
        source: "aws.ec2",
        "detail-type": "EC2 Instance State-change Notification",
        time: "2026-11-15T10:00:00.000Z",
        detail: { "instance-id": "i-0123456789abcdef0", state: "stopped" },
      }),
    }],
  });

  assert.deepEqual(response, { batchItemFailures: [] });
  assert.equal(stored.TableName, "cloudsentinels-test-table");
  assert.equal(stored.Item.PK, "USER#firebase-test-owner");
  assert.match(stored.Item.SK, /^AUTOMATION#2026-11-15T10:00:00\.000Z#event-123$/);
  assert.equal(stored.Item.resourceId, "i-0123456789abcdef0");
  assert.equal(stored.Item.severity, "medium");
  assert.equal(stored.Item.recoveryVerified, false);
  assert.equal(stored.ConditionExpression, "attribute_not_exists(PK) AND attribute_not_exists(SK)");
});

test("returns failed SQS identifiers when records are malformed", async () => {
  const response = await handler({
    Records: [
      { messageId: "bad-json", body: "{" },
      { messageId: "missing-id", body: JSON.stringify({ source: "aws.ec2" }) },
    ],
  });
  assert.deepEqual(response, {
    batchItemFailures: [
      { itemIdentifier: "bad-json" },
      { itemIdentifier: "missing-id" },
    ],
  });
});

test("requires an automation owner instead of writing invisible system records", async (t) => {
  const original = process.env.AUTOMATION_OWNER_ID;
  delete process.env.AUTOMATION_OWNER_ID;
  const originalSend = DynamoDBDocumentClient.prototype.send;
  let called = false;
  DynamoDBDocumentClient.prototype.send = async function () { called = true; return {}; };
  t.after(() => {
    process.env.AUTOMATION_OWNER_ID = original;
    DynamoDBDocumentClient.prototype.send = originalSend;
  });

  const response = await handler({
    Records: [{ messageId: "no-owner", body: JSON.stringify({ id: "evt-no-owner" }) }],
  });
  assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "no-owner" }] });
  assert.equal(called, false);
});
