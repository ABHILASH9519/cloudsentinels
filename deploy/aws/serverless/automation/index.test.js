import test from "node:test";
import assert from "node:assert/strict";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

process.env.TABLE_NAME = "cloudsentinels-test-table";
const { classifyEvent, handler } = await import("./index.js");

test("classifies known events without claiming remediation ran", () => {
  const result = classifyEvent({
    "detail-type": "PodCrashLoopBackOff",
    detail: { clusterName: "demo-cluster" },
  });

  assert.equal(result.status, "PENDING_CLUSTER_ADAPTER");
  assert.equal(result.recommendedAction, "restart-pod");
  assert.equal(result.requiresApproval, false);
  assert.match(result.reason, /no Kubernetes remediation adapter/i);
});

test("blocks known events that do not identify a cluster target", () => {
  const result = classifyEvent({ "detail-type": "NodeNotReady", detail: {} });

  assert.equal(result.status, "BLOCKED_NO_CLUSTER_TARGET");
  assert.equal(result.requiresApproval, true);
  assert.equal(result.clusterName, null);
});

test("observes unknown event types without recommending an action", () => {
  const result = classifyEvent({ "detail-type": "SomethingNew" });

  assert.equal(result.status, "OBSERVED");
  assert.equal(result.recommendedAction, null);
  assert.equal(result.risk, "informational");
});

test("records a valid event with an idempotency condition", async (t) => {
  const originalSend = DynamoDBDocumentClient.prototype.send;
  const calls = [];
  DynamoDBDocumentClient.prototype.send = async function (command) {
    calls.push(command.input);
    return {};
  };
  t.after(() => { DynamoDBDocumentClient.prototype.send = originalSend; });

  const response = await handler({
    Records: [{
      messageId: "message-1",
      body: JSON.stringify({
        id: "event-123",
        source: "cloudsentinels.cluster-agent",
        "detail-type": "CpuThresholdExceeded",
        detail: { clusterName: "demo-cluster" },
      }),
    }],
  });

  assert.deepEqual(response, { batchItemFailures: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].TableName, "cloudsentinels-test-table");
  assert.equal(calls[0].Item.id, "event-123");
  assert.equal(calls[0].Item.status, "PENDING_APPROVAL");
  assert.equal(calls[0].ConditionExpression,
    "attribute_not_exists(PK) AND attribute_not_exists(SK)");
});

test("returns only failed SQS message identifiers for malformed records", async () => {
  const response = await handler({
    Records: [
      { messageId: "bad-json", body: "{" },
      { messageId: "missing-id", body: JSON.stringify({ source: "test" }) },
    ],
  });

  assert.deepEqual(response, {
    batchItemFailures: [
      { itemIdentifier: "bad-json" },
      { itemIdentifier: "missing-id" },
    ],
  });
});

test("treats duplicate DynamoDB events as successfully handled", async (t) => {
  const originalSend = DynamoDBDocumentClient.prototype.send;
  DynamoDBDocumentClient.prototype.send = async function () {
    const error = new Error("already exists");
    error.name = "ConditionalCheckFailedException";
    throw error;
  };
  t.after(() => { DynamoDBDocumentClient.prototype.send = originalSend; });

  const response = await handler({
    Records: [{
      messageId: "duplicate-message",
      body: JSON.stringify({ id: "already-seen", "detail-type": "Unknown" }),
    }],
  });

  assert.deepEqual(response, { batchItemFailures: [] });
});

test("rejects event ids that exceed the DynamoDB key limit", async () => {
  const response = await handler({
    Records: [{
      messageId: "oversized-id",
      body: JSON.stringify({ id: "x".repeat(129), "detail-type": "Unknown" }),
    }],
  });

  assert.deepEqual(response, {
    batchItemFailures: [{ itemIdentifier: "oversized-id" }],
  });
});

test("does not coerce object-shaped cluster targets into fake names", () => {
  const result = classifyEvent({
    "detail-type": "PodCrashLoopBackOff",
    detail: { clusterName: { name: "not-a-valid-target" } },
  });

  assert.equal(result.status, "BLOCKED_NO_CLUSTER_TARGET");
  assert.equal(result.clusterName, null);
});

test("returns a failed SQS item when DynamoDB is unavailable", async (t) => {
  const originalSend = DynamoDBDocumentClient.prototype.send;
  DynamoDBDocumentClient.prototype.send = async function () {
    throw new Error("simulated DynamoDB outage");
  };
  t.after(() => { DynamoDBDocumentClient.prototype.send = originalSend; });

  const response = await handler({
    Records: [{
      messageId: "db-outage",
      body: JSON.stringify({ id: "event-db-outage", "detail-type": "Unknown" }),
    }],
  });

  assert.deepEqual(response, {
    batchItemFailures: [{ itemIdentifier: "db-outage" }],
  });
});
