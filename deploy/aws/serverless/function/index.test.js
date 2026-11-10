import test from "node:test";
import assert from "node:assert/strict";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";

process.env.TABLE_NAME = "cloudsentinels-api-test-table";
process.env.EVENT_BUS_NAME = "cloudsentinels-test-bus";
const { handler } = await import("./index.js");

const originalDbSend = DynamoDBDocumentClient.prototype.send;
const originalEventSend = EventBridgeClient.prototype.send;
const originalConsoleError = console.error;

function createIncidentEvent() {
  return {
    rawPath: "/v1/incidents",
    requestContext: {
      http: { method: "POST" },
      authorizer: { jwt: { claims: { sub: "test-user" } } },
    },
    body: JSON.stringify({
      title: "Test incident",
      severity: "high",
      source: "unit-test",
    }),
  };
}

test("reports EventBridge partial failures without failing incident creation", async (t) => {
  const errors = [];
  let eventBridgeCalls = 0;
  DynamoDBDocumentClient.prototype.send = async (command) => {
    if (command.constructor.name === "UpdateCommand") {
      return { Attributes: { nextId: 1 } };
    }
    return {};
  };
  EventBridgeClient.prototype.send = async () => {
    eventBridgeCalls += 1;
    return {
      FailedEntryCount: 1,
      Entries: [{
        ErrorCode: "InternalFailure",
        ErrorMessage: "simulated event bus failure",
      }],
    };
  };
  console.error = (...args) => errors.push(args);
  t.after(() => {
    DynamoDBDocumentClient.prototype.send = originalDbSend;
    EventBridgeClient.prototype.send = originalEventSend;
    console.error = originalConsoleError;
  });

  const result = await handler(createIncidentEvent());

  assert.equal(result.statusCode, 201);
  assert.equal(eventBridgeCalls, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], "Domain event publish partially failed");
  assert.equal(errors[0][1].failedEntryCount, 1);
  assert.equal(errors[0][1].entryErrors[0].errorCode, "InternalFailure");
});

test("keeps incident creation successful when EventBridge accepts the event", async (t) => {
  DynamoDBDocumentClient.prototype.send = async (command) => {
    if (command.constructor.name === "UpdateCommand") {
      return { Attributes: { nextId: 2 } };
    }
    return {};
  };
  EventBridgeClient.prototype.send = async () => ({
    FailedEntryCount: 0,
    Entries: [{ EventId: "eventbridge-event-id" }],
  });
  t.after(() => {
    DynamoDBDocumentClient.prototype.send = originalDbSend;
    EventBridgeClient.prototype.send = originalEventSend;
  });

  const result = await handler(createIncidentEvent());
  assert.equal(result.statusCode, 201);
  assert.equal(JSON.parse(result.body).title, "Test incident");
});
