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
    const date = cluster.onboardingDate ? new Date(cluster.onboardingDate) : null;
    const ageDays = date && Number.isFinite(date.getTime()) ? Math.floor((now - date) / 86400000) : null;
    const current = live.get(name);
    let classification;
    if (ageDays === null || ageDays > staleAfterDays || ageDays < 0) classification = "STALE";
    else if (!current) classification = "SOURCE_ONLY";
    else if (current.nodeCount !== cluster.nodeCount || current.podCount !== cluster.podCount) classification = "DRIFT";
    else classification = "MATCH";
    return { clusterName: name, environment: cluster.environment, classification, sourceNodeCount: cluster.nodeCount, sourcePodCount: cluster.podCount, liveNodeCount: current?.nodeCount ?? null, livePodCount: current?.podCount ?? null, ageDays };
  });
  for (const current of input.liveClusters ?? []) {
    if (typeof current.clusterName !== "string" || !NAME.test(current.clusterName)) throw new Error("Live cluster name must be DNS-compatible");
    validCount(current.nodeCount, "live nodeCount", current.clusterName);
    validCount(current.podCount, "live podCount", current.clusterName);
    if (!seen.has(current.clusterName.trim().toLowerCase())) results.push({ clusterName: current.clusterName, environment: null, classification: "CLUSTER_ONLY", sourceNodeCount: null, sourcePodCount: null, liveNodeCount: current.nodeCount, livePodCount: current.podCount, ageDays: null });
  }
  const labels = ["MATCH", "SOURCE_ONLY", "CLUSTER_ONLY", "DRIFT", "STALE"];
  const summary = Object.fromEntries(labels.map(label => [label, results.filter(item => item.classification === label).length]));
  return { generatedAt: now.toISOString(), summary, clusters: results };
}
function main() {
  const args = process.argv.slice(2), at = args.indexOf("--input");
  if (at < 0 || !args[at + 1]) throw new Error("Usage: node scripts/eks/validate-airtable-inventory.mjs --input <safe-export.json> [--stale-after-days 90]");
  const staleAt = args.indexOf("--stale-after-days"), staleAfterDays = staleAt >= 0 ? Number(args[staleAt + 1]) : 90;
  const input = JSON.parse(fs.readFileSync(args[at + 1], "utf8"));
  process.stdout.write(JSON.stringify(reconcileInventory(input, { staleAfterDays }), null, 2) + "\n");
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try { main(); } catch (error) { process.stderr.write("Inventory validation failed: " + error.message + "\n"); process.exitCode = 1; }
}
