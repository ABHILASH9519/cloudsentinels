#!/usr/bin/env node
import fs from "node:fs";
const SECRET_KEY = /(kubeconfig|token|secret|credential|private.?key|password|api.?key)/i;
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ENVIRONMENTS = new Set(["Development", "QA", "Staging", "Production"]);
const STATUSES = new Set(["Active", "Inactive", "Provisioning", "Degraded", "Unknown"]);
export function assertNoSecrets(value, path = "$") {
  if (Array.isArray(value)) { value.forEach((item, index) => assertNoSecrets(item, path + "[" + index + "]")); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new Error("Sensitive field is not allowed: " + path + "." + key);
    assertNoSecrets(child, path + "." + key);
  }
}
function validCount(value, field, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(name + ": " + field + " must be a non-negative integer");
}
export function reconcileInventory(input, options = {}) {
  assertNoSecrets(input);
  if (!input || input.source !== "Cloud-Sentinel" || !Array.isArray(input.clusters)) throw new Error('Expected { "source": "Cloud-Sentinel", "clusters": [...] }');
  const staleAfterDays = options.staleAfterDays ?? 90;
  if (!Number.isInteger(staleAfterDays) || staleAfterDays < 1) throw new Error("staleAfterDays must be positive");
  const now = options.now ? new Date(options.now) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid comparison date");
  if (input.liveClusters !== undefined && !Array.isArray(input.liveClusters)) throw new Error("liveClusters must be an array");
  const live = new Map((input.liveClusters ?? []).map(item => [item.clusterName, item]));
  const seen = new Set();
  const results = input.clusters.map(cluster => {
    const name = cluster.clusterName;
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 128 || [...name].some(char => char.charCodeAt(0) < 32)) throw new Error("Cluster name must be non-empty printable text (max 128 chars)");
    const sourceKey = name.trim().toLowerCase();
    if (seen.has(sourceKey)) throw new Error("Duplicate cluster name: " + name);
    seen.add(sourceKey);
    if (!ENVIRONMENTS.has(cluster.environment)) throw new Error(name + ": invalid environment");
    if (!STATUSES.has(cluster.status)) throw new Error(name + ": invalid status");
    validCount(cluster.nodeCount, "nodeCount", name);
    validCount(cluster.podCount, "podCount", name);
    const telemetryDate = cluster.lastSeenAt ? new Date(cluster.lastSeenAt) : null;
    const telemetryAgeDays = telemetryDate && Number.isFinite(telemetryDate.getTime()) ? Math.floor((now - telemetryDate) / 86400000) : null;
    const sourceDate = cluster.recordCreatedAt ? new Date(cluster.recordCreatedAt) : null;
    const sourceRecordAgeDays = sourceDate && Number.isFinite(sourceDate.getTime()) ? Math.floor((now - sourceDate) / 86400000) : null;
    const sourceFresh = sourceRecordAgeDays !== null && sourceRecordAgeDays >= 0 && sourceRecordAgeDays <= staleAfterDays;
    const current = live.get(name);
    let classification;
    if (telemetryAgeDays === null || telemetryAgeDays > staleAfterDays || telemetryAgeDays < 0) classification = "STALE";
    else if (!current) classification = "SOURCE_ONLY";
    else if (current.nodeCount !== cluster.nodeCount || current.podCount !== cluster.podCount) classification = "DRIFT";
    else classification = "MATCH";
    return { clusterName: name, environment: cluster.environment, classification, recordCreatedAt: cluster.recordCreatedAt ?? null, sourceRecordAgeDays, sourceFresh, lastSeenAt: cluster.lastSeenAt ?? null, telemetryAgeDays, linkedNodeCount: cluster.linkedNodeCount ?? 0, healthStatus: cluster.healthStatus ?? null, cpuUsagePercent: cluster.cpuUsagePercent ?? null, sourceNodeCount: cluster.nodeCount, sourcePodCount: cluster.podCount, liveNodeCount: current?.nodeCount ?? null, livePodCount: current?.podCount ?? null };
  });
  for (const current of input.liveClusters ?? []) {
    if (typeof current.clusterName !== "string" || !NAME.test(current.clusterName)) throw new Error("Live cluster name must be DNS-compatible");
    validCount(current.nodeCount, "live nodeCount", current.clusterName);
    validCount(current.podCount, "live podCount", current.clusterName);
    if (!seen.has(current.clusterName.trim().toLowerCase())) results.push({ clusterName: current.clusterName, environment: null, classification: "CLUSTER_ONLY", sourceNodeCount: null, sourcePodCount: null, liveNodeCount: current.nodeCount, livePodCount: current.podCount, ageDays: null });
  }
  const labels = ["MATCH", "SOURCE_ONLY", "CLUSTER_ONLY", "DRIFT", "STALE"];
  const summary = Object.fromEntries(labels.map(label => [label, results.filter(item => item.classification === label).length]));
  return {
    generatedAt: now.toISOString(),
    summary: { ...summary, freshSourceRecords: results.filter(item => item.sourceFresh).length, staleTelemetryRecords: results.filter(item => item.classification === "STALE").length, clustersMissingNodeLinks: results.filter(item => (item.linkedNodeCount ?? 0) === 0).length },
    dataQuality: { sourceRecordFreshnessIsNotRuntimeTelemetry: true, note: "Airtable record creation time proves a recent inventory import only; Last Seen is the separate node telemetry signal." },
    clusters: results
  };
}
export function assertFreshInventory(result) {
  if (result.summary.freshSourceRecords === 0) throw new Error("No recent Airtable cluster inventory rows; refresh the cluster inventory before planning EKS");
  return result;
}
function main() {
  const args = process.argv.slice(2), at = args.indexOf("--input");
  if (at < 0 || !args[at + 1]) throw new Error("Usage: node scripts/eks/validate-airtable-inventory.mjs --input <safe-export.json> [--stale-after-days 90]");
  const staleAt = args.indexOf("--stale-after-days"), staleAfterDays = staleAt >= 0 ? Number(args[staleAt + 1]) : 90;
  const input = JSON.parse(fs.readFileSync(args[at + 1], "utf8"));
  const result = reconcileInventory(input, { staleAfterDays });
  if (args.includes("--require-fresh")) assertFreshInventory(result);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try { main(); } catch (error) { process.stderr.write("Inventory validation failed: " + error.message + "\n"); process.exitCode = 1; }
}
