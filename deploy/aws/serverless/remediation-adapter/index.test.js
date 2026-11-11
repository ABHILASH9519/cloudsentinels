import test from "node:test";
import assert from "node:assert/strict";
import { handler } from "./index.js";

test("accepts an allow-listed command without performing remediation", async () => {
  const result = await handler({
    schemaVersion: "1",
    commandId: "command-123",
    eventId: "event-123",
    action: "restart-pod",
    clusterName: "demo-cluster",
    approvedBy: "human-approver",
    approvedAt: "2026-11-11T10:00:00.000Z",
  });

  assert.equal(result.accepted, true);
  assert.equal(result.recoveryVerified, false);
  assert.equal(result.mode, "dry-run");
  assert.equal(result.executionId, "dry-run-command-123");
  assert.match(result.message, /No AWS or Kubernetes resource was changed/);
});

test("rejects actions outside the remediation allowlist", async () => {
  const result = await handler({
    commandId: "command-123",
    eventId: "event-123",
    action: "delete-cluster",
    clusterName: "demo-cluster",
    approvedBy: "human-approver",
    approvedAt: "2026-11-11T10:00:00.000Z",
  });

  assert.equal(result.accepted, false);
  assert.match(result.error, /not allow-listed/);
});

test("rejects incomplete approval commands", async () => {
  const result = await handler({
    commandId: "command-123",
    eventId: "event-123",
    action: "restart-pod",
  });

  assert.equal(result.accepted, false);
  assert.match(result.error, /Invalid or missing clusterName/);
});

test("does not claim recovery was verified", async () => {
  const result = await handler({
    commandId: "command-124",
    eventId: "event-124",
    action: "rollback-deployment",
    clusterName: "demo-cluster",
    approvedBy: "human-approver",
    approvedAt: "2026-11-11T10:00:00.000Z",
  });

  assert.equal(result.recoveryVerified, false);
});
