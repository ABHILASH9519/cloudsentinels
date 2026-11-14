import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

process.env.ZAPIER_WEBHOOK_SECRET_ARN = "arn:aws:secretsmanager:ap-south-1:123456789012:secret:test";
process.env.TABLE_NAME = "cloudsentinels-relay-test-table";
const signingSecret = "test-signing-secret-with-at-least-32-characters";
const { handler, isCloudWatchAlarmEvent, toPayload } = await import("./index.js");

const originalSecretSend = SecretsManagerClient.prototype.send;
const originalDbSend = DynamoDBDocumentClient.prototype.send;
const originalFetch = globalThis.fetch;
let fetchResponse;
let requests = [];
let requestedKey;
const eventRecords = new Map();

function storeEvent(eventId, attributes = {}) {
  const eventTime = attributes.eventTime ?? "2026-11-10T10:00:00.000Z";
  const ownerId = attributes.ownerId ?? "user-123";
  eventRecords.set(`AUTOMATION#${eventTime}#${eventId}`, {
    id: eventId,
    ownerId,
    eventTime,
    risk: "informational",
    requiresApproval: false,
    ...attributes,
  });
}

SecretsManagerClient.prototype.send = async function () {
  return {
    SecretString: JSON.stringify({
      webhookUrl: "https://hooks.zapier.com/hooks/catch/123/abc",
      signingSecret,
    }),
  };
};

DynamoDBDocumentClient.prototype.send = async function (command) {
  requestedKey = command.input.Key;
  return { Item: eventRecords.get(command.input.Key.SK) };
};

globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  return fetchResponse;
};

test.beforeEach(() => {
  requests = [];
  requestedKey = undefined;
  eventRecords.clear();
  fetchResponse = { ok: true, status: 200 };
});

test.after(() => {
  SecretsManagerClient.prototype.send = originalSecretSend;
  DynamoDBDocumentClient.prototype.send = originalDbSend;
  globalThis.fetch = originalFetch;
});

test("forwards allow-listed event fields and signs the exact request body", async () => {
  storeEvent("event-1", { clusterName: "demo" });
  const result = await handler({
    Records: [{
      messageId: "relay-1",
      body: JSON.stringify({
        id: "event-1",
        source: "cloudsentinels.api",
        time: "2026-11-10T10:00:00.000Z",
        "detail-type": "IncidentCreated",
        detail: {
          userId: "user-123",
          severity: "high",
          incidentId: "incident-9",
          clusterName: "demo",
          secret: "must-not-be-forwarded",
          accessToken: "must-not-be-forwarded",
        },
      }),
    }],
  });

  assert.deepEqual(result, { batchItemFailures: [] });
  assert.equal(requests.length, 1);
  const { url, options } = requests[0];
  assert.equal(url, "https://hooks.zapier.com/hooks/catch/123/abc");
  const payload = JSON.parse(options.body);
  assert.equal(payload.eventId, "event-1");
  assert.equal(payload.eventType, "incident.created");
  assert.equal(payload.sourceEventType, "IncidentCreated");
  assert.equal(payload.ownerId, "user-123");
  assert.equal(payload.eventTime, "2026-11-10T10:00:00.000Z");
  assert.deepEqual(requestedKey, {
    PK: "USER#user-123",
    SK: "AUTOMATION#2026-11-10T10:00:00.000Z#event-1",
  });
  assert.equal(payload.severity, "high");
  assert.equal(payload.incidentId, "incident-9");
  assert.equal(payload.resourceId, undefined);
  assert.equal("secret" in payload, false);
  assert.equal("accessToken" in payload, false);

  const timestamp = options.headers["x-cloudsentinels-timestamp"];
  const expected = createHmac("sha256", signingSecret)
    .update(`${timestamp}.${options.body}`)
    .digest("hex");
  assert.equal(options.headers["x-cloudsentinels-signature"], `sha256=${expected}`);
});

test("returns an SQS partial-batch failure when Zapier responds non-2xx", async () => {
  storeEvent("event-2");
  fetchResponse = {
    ok: false,
    status: 503,
    text: async () => "temporarily unavailable",
  };

  const result = await handler({
    Records: [{
      messageId: "relay-failed",
      body: JSON.stringify({
        id: "event-2",
        source: "cloudsentinels.api",
        "detail-type": "AlertCreated",
      }),
    }],
  });

  assert.deepEqual(result, {
    batchItemFailures: [{ itemIdentifier: "relay-failed" }],
  });
});

test("ignores unsupported event types without calling Zapier", async () => {
  requests = [];
  const result = await handler({
    Records: [{
      messageId: "unsupported",
      body: JSON.stringify({
        id: "event-3",
        "detail-type": "UnlistedEvent",
      }),
    }],
  });

  assert.deepEqual(result, { batchItemFailures: [] });
  assert.equal(requests.length, 0);
});

test("marks malformed JSON for SQS retry", async () => {
  const result = await handler({
    Records: [{ messageId: "bad-json", body: "{" }],
  });

  assert.deepEqual(result, {
    batchItemFailures: [{ itemIdentifier: "bad-json" }],
  });
});

test("adds the configured high-risk action and approval requirement for Zapier", async () => {
  storeEvent("event-node-1", {
    risk: "high",
    requiresApproval: true,
    recommendedAction: "replace-or-recover-node",
    clusterName: "staging-cluster",
  });
  await handler({
    Records: [{
      messageId: "policy-high",
      body: JSON.stringify({
        id: "event-node-1",
        source: "cloudsentinels.cluster-agent",
        time: "2026-11-10T10:00:00.000Z",
        "detail-type": "NodeNotReady",
        detail: { userId: "user-123", clusterName: "staging-cluster" },
      }),
    }],
  });

  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.recommendedAction, "replace-or-recover-node");
  assert.equal(payload.risk, "high");
  assert.equal(payload.requiresApproval, true);
});

test("marks low-risk policy actions as eligible for automatic Zapier filtering", async () => {
  storeEvent("event-pod-1", {
    risk: "medium",
    recommendedAction: "restart-pod",
    requiresApproval: false,
    clusterName: "arn:aws:eks:ap-south-1:123456789012:cluster/staging-cluster",
  });
  await handler({
    Records: [{
      messageId: "policy-low",
      body: JSON.stringify({
        id: "event-pod-1",
        source: "cloudsentinels.cluster-agent",
        time: "2026-11-10T10:00:00.000Z",
        "detail-type": "PodCrashLoopBackOff",
        detail: { userId: "user-123", clusterArn: "arn:aws:eks:ap-south-1:123456789012:cluster/staging-cluster" },
      }),
    }],
  });

  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.clusterRef, "arn:aws:eks:ap-south-1:123456789012:cluster/staging-cluster");
  assert.equal(payload.recommendedAction, "restart-pod");
  assert.equal(payload.risk, "medium");
  assert.equal(payload.requiresApproval, false);
});

test("retries instead of notifying Zapier before the processor persists the event", async () => {
  const result = await handler({
    Records: [{
      messageId: "processor-race",
      body: JSON.stringify({
        id: "event-not-ready",
        source: "cloudsentinels.cluster-agent",
        time: "2026-11-10T10:00:00.000Z",
        "detail-type": "NodeNotReady",
        detail: { userId: "user-123", clusterName: "staging-cluster" },
      }),
    }],
  });

  assert.deepEqual(result, {
    batchItemFailures: [{ itemIdentifier: "processor-race" }],
  });
  assert.equal(requests.length, 0);
});


function alarmEvent(alarmName, state, previousState = "OK") {
  return {
    id: "evt-cloudwatch-test",
    source: "aws.cloudwatch",
    "detail-type": "CloudWatch Alarm State Change",
    time: "2026-11-14T06:00:00.000Z",
    detail: {
      alarmName,
      state: { value: state },
      previousState: { value: previousState },
    },
  };
}

test("Lambda error alarms become sanitized serverless failure events", () => {
  const event = alarmEvent("cloudsentinels-operations-function-errors", "ALARM");
  assert.equal(isCloudWatchAlarmEvent(event), true);
  const payload = toPayload(event);
  assert.equal(payload.eventType, "serverless.invocation_failed");
  assert.equal(payload.sourceType, "aws-cloudwatch");
  assert.equal(payload.severity, "critical");
  assert.equal(payload.status, "ALARM");
  assert.equal(payload.resourceId, "cloudsentinels-operations-function-errors");
  assert.equal(payload.recoveryVerified, false);
  assert.equal("ownerId" in payload, false);
});

test("Lambda alarm recovery becomes a serverless recovery event", () => {
  const payload = toPayload(alarmEvent("cloudsentinels-automation-processor-errors", "OK", "ALARM"));
  assert.equal(payload.eventType, "serverless.invocation_recovered");
  assert.equal(payload.severity, "info");
  assert.equal(payload.status, "OK");
});

test("queue and delivery alarms become service health events", () => {
  const payload = toPayload(alarmEvent("cloudsentinels-automation-dlq-visible-messages", "ALARM"));
  assert.equal(payload.eventType, "server.health.failed");
  assert.equal(payload.severity, "critical");
});

test("non-CloudSentinels alarm events are rejected", () => {
  assert.equal(isCloudWatchAlarmEvent(alarmEvent("other-service-errors", "ALARM")), false);
  assert.equal(isCloudWatchAlarmEvent(alarmEvent("cloudsentinels-service-errors", "INSUFFICIENT_DATA")), false);
});

test("existing domain events retain their persisted policy context", () => {
  const event = {
    id: "evt-domain-test",
    source: "cloudsentinels.cluster-agent",
    "detail-type": "NodeNotReady",
    time: "2026-11-14T06:00:00.000Z",
    detail: { severity: "critical", clusterName: "cluster-a" },
  };
  const payload = toPayload(event, {
    ownerId: "owner-opaque",
    eventTime: "2026-11-14T06:00:00.000Z",
    clusterName: "cluster-a",
    risk: "high",
    recommendedAction: "replace-or-recover-node",
    requiresApproval: true,
  });
  assert.equal(payload.eventType, "cluster.health.degraded");
  assert.equal(payload.sourceEventType, "NodeNotReady");
  assert.equal(payload.clusterRef, "cluster-a");
  assert.equal(payload.risk, "high");
  assert.equal(payload.requiresApproval, true);
});


test("normalizes cluster and server domain events for shared Zapier Paths", () => {
  const cases = [
    ["PodCrashLoopBackOff", "cluster.health.degraded"],
    ["CpuThresholdExceeded", "cluster.health.degraded"],
    ["MemoryPressure", "cluster.health.degraded"],
    ["DeploymentUnhealthy", "cluster.health.degraded"],
    ["ApiLatencyHigh", "server.health.degraded"],
    ["IncidentUpdated", "incident.updated"],
    ["AlertCreated", "alert.created"],
    ["AlertUpdated", "alert.updated"],
  ];
  for (const [sourceEventType, expectedEventType] of cases) {
    const payload = toPayload({
      id: `evt-${sourceEventType}`,
      source: "cloudsentinels.api",
      "detail-type": sourceEventType,
      time: "2026-11-14T06:00:00.000Z",
      detail: {},
    });
    assert.equal(payload.eventType, expectedEventType, sourceEventType);
    assert.equal(payload.sourceEventType, sourceEventType);
  }
});


test("forwards CloudWatch alarm transitions without a DynamoDB incident record", async () => {
  const result = await handler({
    Records: [{
      messageId: "cloudwatch-alarm",
      body: JSON.stringify(alarmEvent("cloudsentinels-operations-function-errors", "ALARM")),
    }],
  });

  assert.deepEqual(result, { batchItemFailures: [] });
  assert.equal(requests.length, 1);
  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.eventType, "serverless.invocation_failed");
  assert.equal(payload.sourceEventType, "CloudWatch Alarm State Change");
  assert.equal(payload.sourceType, "aws-cloudwatch");
  assert.equal(payload.severity, "critical");
  assert.equal(requestedKey, undefined);
});
