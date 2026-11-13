import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

process.env.ZAPIER_WEBHOOK_SECRET_ARN = "arn:aws:secretsmanager:ap-south-1:123456789012:secret:test";
process.env.TABLE_NAME = "cloudsentinels-relay-test-table";
const signingSecret = "test-signing-secret-with-at-least-32-characters";
const { handler } = await import("./index.js");

const originalSecretSend = SecretsManagerClient.prototype.send;
const originalDbSend = DynamoDBDocumentClient.prototype.send;
const originalFetch = globalThis.fetch;
let fetchResponse;
let fetchError = null;
let secretFailure = null;
let requests = [];
const eventRecords = new Map();

function storeEvent(eventId, attributes = {}) {
  eventRecords.set(`EVENT#${eventId}`, {
    id: eventId,
    risk: "informational",
    requiresApproval: false,
    ...attributes,
  });
}

SecretsManagerClient.prototype.send = async function () {
  if (secretFailure) throw secretFailure;
  return {
    SecretString: JSON.stringify({
      webhookUrl: "https://hooks.zapier.com/hooks/catch/123/abc",
      signingSecret,
    }),
  };
};

DynamoDBDocumentClient.prototype.send = async function (command) {
  return { Item: eventRecords.get(command.input.Key.SK) };
};

globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  if (fetchError) throw fetchError;
  return fetchResponse;
};

test.beforeEach(() => {
  requests = [];
  eventRecords.clear();
  fetchResponse = { ok: true, status: 200 };
  fetchError = null;
  secretFailure = null;
});

test.after(() => {
  SecretsManagerClient.prototype.send = originalSecretSend;
  DynamoDBDocumentClient.prototype.send = originalDbSend;
  globalThis.fetch = originalFetch;
});

test("returns an SQS partial-batch failure when Secrets Manager is unavailable", async () => {
  secretFailure = new Error("simulated Secrets Manager outage");
  const result = await handler({
    Records: [{
      messageId: "secrets-unavailable",
      body: JSON.stringify({
        id: "event-secret-outage",
        "detail-type": "IncidentCreated",
      }),
    }],
  });

  assert.deepEqual(result, {
    batchItemFailures: [{ itemIdentifier: "secrets-unavailable" }],
  });
  assert.equal(requests.length, 0);
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
  assert.equal(payload.eventType, "IncidentCreated");
  assert.equal(payload.severity, "high");
  assert.equal("secret" in payload, false);
  assert.equal("accessToken" in payload, false);

  const timestamp = options.headers["x-cloudsentinels-timestamp"];
  const expected = createHmac("sha256", signingSecret)
    .update(`${timestamp}.${options.body}`)
    .digest("hex");
  assert.equal(options.headers["x-cloudsentinels-signature"], `sha256=${expected}`);
});

test("returns an SQS partial-batch failure when the webhook request times out", async () => {
  fetchError = Object.assign(new Error("simulated webhook timeout"), {
    name: "TimeoutError",
  });
  storeEvent("event-timeout");
  const result = await handler({
    Records: [{
      messageId: "webhook-timeout",
      body: JSON.stringify({
        id: "event-timeout",
        "detail-type": "AlertCreated",
      }),
    }],
  });

  assert.deepEqual(result, {
    batchItemFailures: [{ itemIdentifier: "webhook-timeout" }],
  });
  assert.equal(requests.length, 1);
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
        "detail-type": "NodeNotReady",
        detail: { clusterName: "staging-cluster" },
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
        "detail-type": "PodCrashLoopBackOff",
        detail: { clusterArn: "arn:aws:eks:ap-south-1:123456789012:cluster/staging-cluster" },
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
        "detail-type": "NodeNotReady",
        detail: { clusterName: "staging-cluster" },
      }),
    }],
  });

  assert.deepEqual(result, {
    batchItemFailures: [{ itemIdentifier: "processor-race" }],
  });
  assert.equal(requests.length, 0);
});
