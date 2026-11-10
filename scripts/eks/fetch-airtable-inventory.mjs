#!/usr/bin/env node
import fs from "node:fs";

const BASE_ID = "app3xn3iXAsm7MgA7";
const CLUSTER_TABLE_ID = "tblkCeiGBpVuHgpvy";
const ALLOWED_FIELDS = [
  "Cluster Name", "Environment", "Status", "Node Count", "Pod Count",
  "Onboarding Date"
];

export function normalizeClusterRecord(fields) {
  const clusterName = fields["Cluster Name"];
  if (typeof clusterName !== "string" || !clusterName.trim()) throw new Error("Airtable cluster record has no Cluster Name");
  return {
    clusterName: clusterName.trim(),
    environment: fields["Environment"],
    status: fields["Status"],
    onboardingDate: fields["Onboarding Date"] ?? null,
    nodeCount: fields["Node Count"],
    podCount: fields["Pod Count"]
  };
}

async function fetchClusters(token) {
  const records = [];
  let offset;
  do {
    const url = new URL("https://api.airtable.com/v0/" + BASE_ID + "/" + CLUSTER_TABLE_ID);
    url.searchParams.set("pageSize", "100");
    for (const field of ALLOWED_FIELDS) url.searchParams.append("fields[]", field);
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!response.ok) throw new Error("Airtable request failed with HTTP " + response.status);
    const page = await response.json();
    records.push(...(page.records ?? []).map(record => normalizeClusterRecord(record.fields ?? {})));
    offset = page.offset;
  } while (offset);
  return { source: "Cloud-Sentinel", generatedAt: new Date().toISOString(), clusters: records };
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--output");
  if (at < 0 || !args[at + 1]) throw new Error("Usage: node scripts/eks/fetch-airtable-inventory.mjs --output <safe-export.json>");
  const token = process.env.AIRTABLE_API_TOKEN;
  if (!token) throw new Error("AIRTABLE_API_TOKEN environment secret is required");
  const output = await fetchClusters(token);
  fs.writeFileSync(args[at + 1], JSON.stringify(output, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write("Exported " + output.clusters.length + " allowlisted cluster records; sensitive fields were not requested.\n");
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch(error => { process.stderr.write("Airtable inventory export failed: " + error.message + "\n"); process.exitCode = 1; });
}
