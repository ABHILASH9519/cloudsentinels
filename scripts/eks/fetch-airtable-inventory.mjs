#!/usr/bin/env node
import fs from "node:fs";

const BASE_ID = "app3xn3iXAsm7MgA7";
const CLUSTER_TABLE_ID = "tblkCeiGBpVuHgpvy";
const NODE_TABLE_ID = "tbliN9Rr6EcMsfwuk";
const CLUSTER_FIELDS = ["Cluster Name", "Environment", "Status", "Node Count", "Pod Count", "Onboarding Date"];
const NODE_FIELDS = ["Cluster", "Last Seen"];

export function normalizeClusterRecord(fields, lastSeenAt = null) {
  const clusterName = fields["Cluster Name"];
  if (typeof clusterName !== "string" || !clusterName.trim()) throw new Error("Airtable cluster record has no Cluster Name");
  return {
    clusterName: clusterName.trim(),
    environment: fields["Environment"],
    status: fields["Status"],
    onboardingDate: fields["Onboarding Date"] ?? null,
    lastSeenAt,
    nodeCount: fields["Node Count"],
    podCount: fields["Pod Count"]
  };
}

async function fetchRecords(tableId, token, fields) {
  const records = [];
  let offset;
  do {
    const url = new URL("https://api.airtable.com/v0/" + BASE_ID + "/" + tableId);
    url.searchParams.set("pageSize", "100");
    for (const field of fields) url.searchParams.append("fields[]", field);
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!response.ok) throw new Error("Airtable request failed with HTTP " + response.status);
    const page = await response.json();
    records.push(...(page.records ?? []));
    offset = page.offset;
  } while (offset);
  return records;
}

async function fetchClusters(token) {
  const [clusterRecords, nodeRecords] = await Promise.all([
    fetchRecords(CLUSTER_TABLE_ID, token, CLUSTER_FIELDS),
    fetchRecords(NODE_TABLE_ID, token, NODE_FIELDS)
  ]);
  const clusterNames = new Map(clusterRecords.map(record => [record.id, record.fields?.["Cluster Name"]]));
  const latestSeenByCluster = new Map();
  for (const node of nodeRecords) {
    const lastSeen = node.fields?.["Last Seen"];
    if (!lastSeen || !Number.isFinite(new Date(lastSeen).getTime())) continue;
    for (const clusterLink of node.fields?.Cluster ?? []) {
      const clusterName = clusterNames.get(clusterLink);
      if (!clusterName) continue;
      const previous = latestSeenByCluster.get(clusterName);
      if (!previous || new Date(lastSeen) > new Date(previous)) latestSeenByCluster.set(clusterName, lastSeen);
    }
  }
  return {
    source: "Cloud-Sentinel",
    generatedAt: new Date().toISOString(),
    clusters: clusterRecords.map(record => normalizeClusterRecord(
      record.fields ?? {},
      latestSeenByCluster.get(record.fields?.["Cluster Name"]) ?? null
    ))
  };
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--output");
  if (at < 0 || !args[at + 1]) throw new Error("Usage: node scripts/eks/fetch-airtable-inventory.mjs --output <safe-export.json>");
  const token = process.env.AIRTABLE_API_TOKEN;
  if (!token) throw new Error("AIRTABLE_API_TOKEN environment secret is required");
  const output = await fetchClusters(token);
  fs.writeFileSync(args[at + 1], JSON.stringify(output, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write("Exported " + output.clusters.length + " clusters and linked-node freshness metadata; sensitive fields were not requested.\n");
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch(error => { process.stderr.write("Airtable inventory export failed: " + error.message + "\n"); process.exitCode = 1; });
}
