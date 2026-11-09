import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = process.env.TABLE_NAME;

const response = (statusCode, body) => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store",
  },
  body: JSON.stringify(body),
});

function callerId(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  const sub = claims?.sub;
  if (typeof sub !== "string" || !sub) {
    const error = new Error("Authenticated Cognito subject is missing.");
    error.statusCode = 401;
    throw error;
  }
  return sub;
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  if (raw.length > 256 * 1024) {
    const error = new Error("Request body is too large.");
    error.statusCode = 413;
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function cleanText(value, field, max, required = false) {
  if (typeof value !== "string" || (required && !value.trim())) {
    const error = new Error(`${field} is required.`);
    error.statusCode = 400;
    throw error;
  }
  if (value.length > max) {
    const error = new Error(`${field} exceeds ${max} characters.`);
    error.statusCode = 400;
    throw error;
  }
  return value;
}

async function listItems(userId, prefix) {
  const result = await db.send(new QueryCommand({
    TableName: table,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":prefix": prefix },
  }));
  return result.Items ?? [];
}

async function createItem(userId, type, body) {
  const now = new Date().toISOString();
  const counter = await db.send(new UpdateCommand({
    TableName: table,
    Key: { PK: `USER#${userId}`, SK: `COUNTER#${type}` },
    UpdateExpression: "ADD #nextId :one",
    ExpressionAttributeNames: { "#nextId": "nextId" },
    ExpressionAttributeValues: { ":one": 1 },
    ReturnValues: "UPDATED_NEW",
  }));
  const id = String(counter.Attributes.nextId);
  const item = {
    PK: `USER#${userId}`,
    SK: `${type}#${id.padStart(16, "0")}`,
    id,
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
    ...body,
  };
  await db.send(new PutCommand({ TableName: table, Item: item, ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" }));
  return item;
}

async function getItem(userId, type, id) {
  const result = await db.send(new GetCommand({
    TableName: table,
    Key: { PK: `USER#${userId}`, SK: `${type}#${String(id).padStart(16, "0")}` },
  }));
  return result.Item ?? null;
}

async function updateItem(userId, type, id, body) {
  const current = await getItem(userId, type, id);
  if (!current) return null;
  const allowed = type === "INCIDENT"
    ? ["status", "aiSummary", "rootCause", "suggestedFix", "assignee", "title", "severity"]
    : ["status"];
  const patch = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
  const names = { "#updatedAt": "updatedAt" };
  const values = { ":updatedAt": new Date().toISOString() };
  const sets = ["#updatedAt = :updatedAt"];
  for (const [key, value] of Object.entries(patch)) {
    names[`#${key}`] = key;
    values[`:${key}`] = value;
    sets.push(`#${key} = :${key}`);
  }
  await db.send(new UpdateCommand({
    TableName: table,
    Key: { PK: `USER#${userId}`, SK: `${type}#${String(id).padStart(16, "0")}` },
    UpdateExpression: `SET ${sets.join(", ")}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
  }));
  return getItem(userId, type, id);
}

export async function handler(event) {
  try {
    const method = event.requestContext?.http?.method ?? "GET";
    const path = event.rawPath ?? "/";
    if (path.endsWith("/health") && method === "GET") {
      return response(200, { status: "ok", service: "cloudsentinels-aws-api" });
    }

    const userId = callerId(event);
    if (path.endsWith("/me") && method === "GET") {
      const claims = event.requestContext.authorizer.jwt.claims;
      return response(200, {
        id: userId,
        email: claims.email ?? null,
        emailVerified: claims.email_verified === true || claims.email_verified === "true",
      });
    }

    const body = parseBody(event);
    const segments = path.split("/").filter(Boolean);
    const resource = segments[1];
    const id = segments[2];
    const now = new Date().toISOString();


    if (resource === "profile" && segments.length === 2) {
      if (method === "GET") {
        const profile = await db.send(new GetCommand({ TableName: table, Key: { PK: `USER#${userId}`, SK: "PROFILE#SELF" } }));
        return response(200, profile.Item ? { name: profile.Item.name } : null);
      }
      if (method === "PUT") {
        const profile = { PK: `USER#${userId}`, SK: "PROFILE#SELF", id: "SELF", ownerId: userId, name: cleanText(body.name, "name", 120, true), updatedAt: now };
        await db.send(new PutCommand({ TableName: table, Item: profile }));
        return response(200, { name: profile.name });
      }
    }

    if (resource === "incidents" && segments.length === 2) {
      if (method === "GET") return response(200, await listItems(userId, "INCIDENT#"));
      if (method === "POST") {
        const item = await createItem(userId, "INCIDENT", {
          title: cleanText(body.title, "title", 200, true),
          severity: cleanText(body.severity, "severity", 20, true),
          status: "open",
          source: cleanText(body.source ?? "", "source", 100),
          rawLog: cleanText(body.rawLog ?? "", "rawLog", 20000),
          aiSummary: "",
          rootCause: "",
          suggestedFix: "",
          assignee: "",
        });
        return response(201, item);
      }
    }

    if (resource === "incidents" && id && segments.length === 3) {
      if (method === "GET") {
        const item = await getItem(userId, "INCIDENT", id);
        return item ? response(200, item) : response(404, { error: "Incident not found." });
      }
      if (method === "PATCH" || method === "PUT") {
        const item = await updateItem(userId, "INCIDENT", id, body);
        return item ? response(200, item) : response(404, { error: "Incident not found." });
      }
      if (method === "DELETE") {
        const current = await getItem(userId, "INCIDENT", id);
        if (!current) return response(404, { error: "Incident not found." });
        await db.send(new DeleteCommand({ TableName: table, Key: { PK: `USER#${userId}`, SK: `INCIDENT#${String(id).padStart(16, "0")}` } }));
        return response(200, { deleted: true });
      }
    }

    if (resource === "incidents" && id && segments[3] === "comments") {
      if (method === "GET") return response(200, await listItems(userId, `COMMENT#${id}#`));
      if (method === "POST") {
        const incident = await getItem(userId, "INCIDENT", id);
        if (!incident) return response(404, { error: "Incident not found." });
        const comment = await createItem(userId, `COMMENT#${id}`, {
          incidentId: id,
          author: userId,
          text: cleanText(body.text, "text", 5000, true),
          createdAt: now,
        });
        return response(201, comment);
      }
    }

    if (resource === "alerts" && segments.length === 2) {
      if (method === "GET") return response(200, await listItems(userId, "ALERT#"));
      if (method === "POST") {
        const alert = await createItem(userId, "ALERT", {
          title: cleanText(body.title, "title", 200, true),
          severity: cleanText(body.severity, "severity", 20, true),
          source: cleanText(body.source ?? "", "source", 100),
          message: cleanText(body.message ?? "", "message", 5000),
          status: "active",
          timestamp: now,
        });
        return response(201, alert);
      }
    }

    if (resource === "alerts" && id) {
      if (method === "PATCH" || method === "PUT") {
        const item = await updateItem(userId, "ALERT", id, body);
        return item ? response(200, item) : response(404, { error: "Alert not found." });
      }
    }

    if (resource === "metrics" && segments.length === 2) {
      if (method === "GET") return response(200, await listItems(userId, "METRIC#"));
      if (method === "POST") {
        if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
          return response(400, { error: "Metric value must be a finite number." });
        }
        const item = await createItem(userId, "METRIC", {
          name: cleanText(body.name, "name", 100, true),
          value: body.value,
          unit: cleanText(body.unit ?? "", "unit", 30),
          source: cleanText(body.source ?? "", "source", 100),
          timestamp: now,
        });
        return response(201, item);
      }
    }

    return response(404, { error: "Route not found." });
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    return response(status, {
      error: status >= 500 ? "The request could not be completed." : error.message,
    });
  }
}
