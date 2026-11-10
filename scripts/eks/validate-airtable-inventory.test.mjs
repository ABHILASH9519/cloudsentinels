import test from "node:test";
import assert from "node:assert/strict";
import { assertNoSecrets, reconcileInventory } from "./validate-airtable-inventory.mjs";
import { normalizeClusterRecord } from "./fetch-airtable-inventory.mjs";
const now = "2026-11-10T00:00:00.000Z";
const base = { source: "Cloud-Sentinel", clusters: [{ clusterName: "review-cluster", environment: "Development", status: "Active", onboardingDate: "2023-03-25T00:00:00.000Z", lastSeenAt: "2026-11-01T00:00:00.000Z", nodeCount: 2, podCount: 8 }], liveClusters: [{ clusterName: "review-cluster", nodeCount: 2, podCount: 8 }, { clusterName: "unlisted-cluster", nodeCount: 1, podCount: 3 }] };
test("matches fresh source inventory and finds cluster-only resources", () => { const r = reconcileInventory(base, { now }); assert.equal(r.summary.MATCH, 1); assert.equal(r.summary.CLUSTER_ONLY, 1); });
test("marks historical snapshots stale", () => { const x = structuredClone(base); x.clusters[0].lastSeenAt = "2024-06-01T00:00:00.000Z"; assert.equal(reconcileInventory(x, { now }).clusters[0].classification, "STALE"); });
test("detects node and pod count drift", () => { const x = structuredClone(base); x.liveClusters[0].nodeCount = 4; assert.equal(reconcileInventory(x, { now }).clusters[0].classification, "DRIFT"); });
test("marks fresh source-only records", () => { const x = structuredClone(base); x.liveClusters = []; assert.equal(reconcileInventory(x, { now }).clusters[0].classification, "SOURCE_ONLY"); });
test("rejects credential-bearing fields", () => { assert.throws(() => assertNoSecrets({ clusters: [], secureOnboardingToken: "redacted" }), /Sensitive field/); });
test("rejects duplicate names and malformed counts", () => { const x = structuredClone(base); x.clusters.push(structuredClone(x.clusters[0])); assert.throws(() => reconcileInventory(x, { now }), /Duplicate cluster/); const y = structuredClone(base); y.clusters[0].nodeCount = -1; assert.throws(() => reconcileInventory(y, { now }), /nodeCount/); });

test("accepts a planned human-readable Airtable cluster label and marks missing date stale", () => {
  const input = { source: "Cloud-Sentinel", clusters: [{ clusterName: "CloudSentinels Showcase K3s (planned)", environment: "Development", status: "Provisioning", onboardingDate: null, lastSeenAt: null, nodeCount: 0, podCount: 0 }] };
  assert.equal(reconcileInventory(input, { now }).clusters[0].classification, "STALE");
});

test("Airtable export normalization returns only allowlisted cluster fields", () => {
  const normalized = normalizeClusterRecord({
    "Cluster Name": "review-cluster",
    "Environment": "Development",
    "Status": "Active",
    "Node Count": 2,
    "Pod Count": 8,
    "Onboarding Date": "2026-11-01T00:00:00.000Z",
    "Kubeconfig": [{ url: "must-not-be-exported" }],
    "Secure Onboarding Token": "must-not-be-exported"
  });
  assert.deepEqual(Object.keys(normalized).sort(), ["clusterName", "environment", "lastSeenAt", "nodeCount", "onboardingDate", "podCount", "status"].sort());
  assert.equal(normalized.clusterName, "review-cluster");
});

test("uses linked-node Last Seen rather than onboarding date for freshness", () => {
  const input = structuredClone(base);
  input.clusters[0].onboardingDate = "2023-03-25T00:00:00.000Z";
  input.clusters[0].lastSeenAt = "2026-11-09T00:00:00.000Z";
  assert.equal(reconcileInventory(input, { now }).clusters[0].classification, "MATCH");
});
