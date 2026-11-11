import test from "node:test";
import assert from "node:assert/strict";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";


process.env.TABLE_NAME = "cloudsentinels-api-test-table";
process.env.EVENT_BUS_NAME = "cloudsentinels-test-bus";
process.env.BEDROCK_MODEL_ID = "in.anthropic.claude-sonnet-5";
const { handler } = await import("./index.js");

const originalDbSend = DynamoDBDocumentClient.prototype.send;
const originalEventSend = EventBridgeClient.prototype.send;
const originalBedrockSend = BedrockRuntimeClient.prototype.send;
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

test("lists automation activity only from the authenticated user's partition", async (t) => {
  let queryInput;
  DynamoDBDocumentClient.prototype.send = async (command) => {
    queryInput = command.input;
    return { Items: [{ id: "evt-1", eventType: "IncidentCreated", status: "OBSERVED" }] };
  };
  t.after(() => { DynamoDBDocumentClient.prototype.send = originalDbSend; });

  const result = await handler({
    rawPath: "/v1/automation/events",
    requestContext: {
      http: { method: "GET" },
      authorizer: { jwt: { claims: { sub: "cognito-user-42" } } },
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(queryInput.ExpressionAttributeValues[":pk"], "USER#cognito-user-42");
  assert.equal(queryInput.ExpressionAttributeValues[":prefix"], "AUTOMATION#");
  assert.equal(queryInput.Limit, 100);
  assert.equal(JSON.parse(result.body)[0].id, "evt-1");
});

test("generates a redacted Bedrock analysis and persists it to the owned incident", async (t) => {
  let stored = {
    PK: "USER#test-user",
    SK: "INCIDENT#0000000000000042",
    id: "42",
    title: "API latency spike",
    severity: "high",
    source: "synthetic",
    rawLog: "password=super-secret user@example.com request timed out",
    status: "open",
  };
  let modelInput;
  DynamoDBDocumentClient.prototype.send = async (command) => {
    if (command.constructor.name === "GetCommand") return { Item: stored };
    if (command.constructor.name === "UpdateCommand") {
      for (const [alias, field] of Object.entries(command.input.ExpressionAttributeNames)) {
        const valueAlias = `:${alias.slice(1)}`;
        if (Object.hasOwn(command.input.ExpressionAttributeValues, valueAlias)) {
          stored[field] = command.input.ExpressionAttributeValues[valueAlias];
        }
      }
      return {};
    }
    return {};
  };
  BedrockRuntimeClient.prototype.send = async (command) => {
    modelInput = command.input;
    return {
      output: {
        message: {
          content: [{
            text: JSON.stringify({
              summary: "The API is experiencing elevated request latency.",
              rootCause: "The supplied log shows request timeouts; the underlying dependency is not identified.",
              suggestedFix: "Inspect upstream dependency latency, API Gateway metrics, and Lambda duration before changing capacity.",
            }),
          }],
        },
      },
    };
  };
  EventBridgeClient.prototype.send = async () => ({ FailedEntryCount: 0, Entries: [{ EventId: "analysis-event" }] });
  t.after(() => {
    DynamoDBDocumentClient.prototype.send = originalDbSend;
    EventBridgeClient.prototype.send = originalEventSend;
    BedrockRuntimeClient.prototype.send = originalBedrockSend;
  });

  const result = await handler({
    rawPath: "/v1/incidents/42/analyze",
    requestContext: {
      http: { method: "POST" },
      authorizer: { jwt: { claims: { sub: "test-user" } } },
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).aiSummary, "The API is experiencing elevated request latency.");
  assert.equal(JSON.parse(result.body).aiModelId, "in.anthropic.claude-sonnet-5");
  assert.equal(modelInput.modelId, "in.anthropic.claude-sonnet-5");
  const prompt = modelInput.messages[0].content[0].text;
  assert.equal(prompt.includes("super-secret"), false);
  assert.equal(prompt.includes("user@example.com"), false);
  assert.equal(prompt.includes("[REDACTED_EMAIL]"), true);
});

test("returns a clear unavailable response when Bedrock is not configured", async (t) => {
  const configuredModel = process.env.BEDROCK_MODEL_ID;
  delete process.env.BEDROCK_MODEL_ID;
  t.after(() => { process.env.BEDROCK_MODEL_ID = configuredModel; });

  const result = await handler({
    rawPath: "/v1/incidents/42/analyze",
    requestContext: {
      http: { method: "POST" },
      authorizer: { jwt: { claims: { sub: "test-user" } } },
    },
  });
  assert.equal(result.statusCode, 404);
});
