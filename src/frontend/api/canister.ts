import { createHmac, createPublicKey, verify as verifySignature } from "node:crypto";
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { Principal } from "@icp-sdk/core/principal";
import { idlFactory } from "../src/declarations/backend.did.js";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const ALLOWED_METHODS: Record<string, number> = {
  addAlert: 4,
  addComment: 3,
  addMetric: 4,
  createIncident: 4,
  deleteIncident: 1,
  getActiveAlerts: 0,
  getAlerts: 0,
  getCallerUserProfile: 0,
  getCallerUserRole: 0,
  getCommentsByIncident: 1,
  getDashboardSummary: 0,
  getIncident: 1,
  getMetricsByName: 1,
  getRecentMetrics: 1,
  isCallerAdmin: 0,
  listIncidents: 0,
  saveCallerUserProfile: 1,
  updateAlertStatus: 2,
  updateIncidentAIFields: 4,
  updateIncidentStatus: 2,
};

let jwksCache: { expiresAt: number; keys: JsonWebKey[] } | undefined;

function fail(status: number, message: string): never {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = status;
  throw error;
}

function parseBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function parseJsonSegment(value: string): Record<string, unknown> {
  return JSON.parse(parseBase64Url(value).toString("utf8"));
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) fail(503, `Server authentication is not configured (${name}).`);
  return value;
}

async function getJwks(issuer: string): Promise<JsonWebKey[]> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetch(`${issuer}/.well-known/jwks.json`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) fail(503, "Clerk signing keys are temporarily unavailable.");
  const body = (await response.json()) as { keys?: JsonWebKey[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    fail(503, "Clerk did not return a valid signing-key set.");
  }
  jwksCache = { keys: body.keys, expiresAt: Date.now() + 10 * 60 * 1000 };
  return body.keys;
}

async function verifyClerkSession(request: any): Promise<{ userId: string }> {
  const secretKey = requiredEnv("CLERK_SECRET_KEY");
  const issuer = requiredEnv("CLERK_ISSUER").replace(/\/$/, "");
  const authorizedParties = requiredEnv("CLERK_AUTHORIZED_PARTIES")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!issuer.startsWith("https://") || authorizedParties.length === 0) {
    fail(503, "Clerk issuer or authorized-party configuration is invalid.");
  }

  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    fail(401, "Sign in is required.");
  }

  const token = authorization.slice(7).trim();
  const segments = token.split(".");
  if (segments.length !== 3) fail(401, "Invalid Clerk session token.");

  const header = parseJsonSegment(segments[0]);
  const claims = parseJsonSegment(segments[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    fail(401, "Unsupported Clerk session-token signature.");
  }

  const keys = await getJwks(issuer);
  const jwk = keys.find((key) => (key as JsonWebKey & { kid?: string }).kid === header.kid);
  if (!jwk || jwk.kty !== "RSA") fail(401, "Clerk signing key was not recognized.");

  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const signingInput = Buffer.from(`${segments[0]}.${segments[1]}`);
  const signature = parseBase64Url(segments[2]);
  if (!verifySignature("RSA-SHA256", signingInput, publicKey, signature)) {
    fail(401, "Clerk session-token signature is invalid.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    claims.iss !== issuer ||
    typeof claims.sub !== "string" ||
    !claims.sub ||
    typeof claims.sid !== "string" ||
    !claims.sid ||
    typeof claims.exp !== "number" ||
    claims.exp <= now ||
    (typeof claims.nbf === "number" && claims.nbf > now + 5) ||
    (typeof claims.iat === "number" && claims.iat > now + 5) ||
    typeof claims.azp !== "string" ||
    !authorizedParties.includes(claims.azp)
  ) {
    fail(401, "Clerk session claims are invalid or expired.");
  }

  // A valid signature alone does not prove the session is still active.
  // Check the live Clerk session state before authorizing a canister call.
  const sessionResponse = await fetch(
    `https://api.clerk.com/v1/sessions/${encodeURIComponent(claims.sid)}`,
    {
      headers: {
        authorization: `Bearer ${secretKey}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!sessionResponse.ok) fail(401, "Clerk session is no longer active.");
  const session = (await sessionResponse.json()) as {
    id?: string;
    user_id?: string;
    status?: string;
  };
  if (
    session.id !== claims.sid ||
    session.user_id !== claims.sub ||
    session.status !== "active"
  ) {
    fail(401, "Clerk session is no longer active.");
  }

  return { userId: claims.sub };
}

function decodeJson(value: any): any {
  if (Array.isArray(value)) return value.map(decodeJson);
  if (value && typeof value === "object") {
    if (
      Object.keys(value).length === 1 &&
      typeof value.__bigint === "string" &&
      /^-?\d+$/.test(value.__bigint)
    ) {
      return BigInt(value.__bigint);
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, decodeJson(child)]),
    );
  }
  return value;
}

function encodeJson(value: any): any {
  if (typeof value === "bigint") return { __bigint: value.toString() };
  if (Array.isArray(value)) return value.map(encodeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, encodeJson(child)]),
    );
  }
  return value;
}

async function createUserActor(userId: string): Promise<any> {
  const identitySecret = requiredEnv("ICP_GATEWAY_IDENTITY_SECRET");
  if (identitySecret.length < 32) {
    fail(503, "The ICP gateway identity secret must contain at least 32 characters.");
  }

  const canisterId = Principal.fromText(requiredEnv("ICP_BACKEND_CANISTER_ID"));
  const host = process.env.ICP_HOST || "https://icp-api.io";
  const seed = createHmac("sha256", identitySecret)
    .update("cloudsentinels:clerk-user:")
    .update(userId)
    .digest();
  const identity = Ed25519KeyIdentity.generate(new Uint8Array(seed));
  const agent = await HttpAgent.create({ host, identity });
  const actor = Actor.createActor(idlFactory, { agent, canisterId });

  // Register this deterministic, server-held identity as a regular canister user.
  // The browser never receives the private key or the derived principal.
  await actor._initializeAccessControlWithSecret("");
  return actor;
}

export default async function handler(request: any, response: any) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const { userId } = await verifyClerkSession(request);
    const body = request.body ?? {};
    const method = body.method;
    const args = Array.isArray(body.args) ? decodeJson(body.args) : null;

    if (
      typeof method !== "string" ||
      !(method in ALLOWED_METHODS) ||
      !args ||
      args.length !== ALLOWED_METHODS[method]
    ) {
      fail(400, "Unsupported canister operation or invalid arguments.");
    }

    const actor = await createUserActor(userId);
    const operation = actor[method];
    if (typeof operation !== "function") {
      fail(400, "Canister operation is unavailable.");
    }

    const result = await operation(...args);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ result: encodeJson(result) as JsonValue });
  } catch (error) {
    const status = Number((error as { statusCode?: number })?.statusCode) || 500;
    if (status >= 500) {
      response.status(status).json({
        error: status === 503
          ? (error as Error).message
          : "The authenticated canister request could not be completed.",
      });
      return;
    }
    response.status(status).json({ error: (error as Error).message });
  }
}
