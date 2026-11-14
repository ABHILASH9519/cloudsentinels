import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.join(dir, "n8n-cloudsentinels-events.json");
const destination = path.join(dir, "n8n-cloudsentinels-unified.json");
const nodesDir = path.join(dir, "nodes");
const workflow = JSON.parse(fs.readFileSync(workflowPath, "utf8"));

workflow.name = "CloudSentinels - Unified Multi-Cluster Self-Healing";
workflow.id = "cloudsentinelsUnified";
workflow.active = false;

const webhook = workflow.nodes.find((node) => node.name === "CloudSentinels Event Webhook");
const normalize = workflow.nodes.find((node) => node.name === "Validate and Normalize Event");
if (!webhook || !normalize) throw new Error("Required intake/normalization node is missing.");
webhook.parameters.responseMode = "lastNode";
webhook.parameters.path = "cloudsentinels/unified-events";
webhook.webhookId = "c9e9d79b-0a9c-49f2-ae32-82d16d97c7e5";

const oldAllowlist = "const allowed = ['schemaVersion','eventId','eventType','occurredAt','clusterId','clusterName','sourceType','environment','severity','title','summary'];";
const newAllowlist = "const allowed = ['schemaVersion','eventId','eventType','occurredAt','clusterId','clusterName','sourceType','environment','severity','title','summary','resourceId','resourceKind','resourceName','namespace','region','service','accountId','action','resourceState'];";
if (!normalize.parameters.jsCode.includes(oldAllowlist)) throw new Error("Base event allowlist did not match expected version.");
normalize.parameters.jsCode = normalize.parameters.jsCode.replace(oldAllowlist, newAllowlist);

const bodyLine = "let body = root.body !== undefined ? parseObject(root.body, 'request body') : root;";
if (!normalize.parameters.jsCode.includes(bodyLine)) throw new Error("Webhook body parser anchor did not match expected version.");
const eventBridgeNormalize = fs.readFileSync(path.join(nodesDir, "eventbridge-normalize.js"), "utf8");
normalize.parameters.jsCode = normalize.parameters.jsCode.replace(bodyLine, bodyLine + "\n" + eventBridgeNormalize);

const policyCode = fs.readFileSync(path.join(nodesDir, "unified-remediation-policy.js"), "utf8");
const runbookCode = fs.readFileSync(path.join(nodesDir, "shared-remediation-runbook.js"), "utf8");

const policyNode = {
  parameters: { mode: "runOnceForAllItems", jsCode: policyCode },
  id: "f7b8d32e-7d25-4e3f-9e21-7e8e3e4a1001",
  name: "Unified Remediation Policy",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [760, 560]
};
const runbookNode = {
  parameters: { mode: "runOnceForAllItems", jsCode: runbookCode },
  id: "f7b8d32e-7d25-4e3f-9e21-7e8e3e4a1002",
  name: "Build Shared Remediation Runbook",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [1900, 300]
};

workflow.nodes = workflow.nodes.filter((node) => !["Unified Remediation Policy", "Build Shared Remediation Runbook"].includes(node.name));
workflow.nodes.push(policyNode, runbookNode);

workflow.connections["Validate and Normalize Event"].main = [[{ node: "Unified Remediation Policy", type: "main", index: 0 }]];
workflow.connections["Unified Remediation Policy"] = { main: [[{ node: "Critical Event?", type: "main", index: 0 }]] };
for (const terminal of ["Prepare Critical Alert", "Prepare Degraded Alert", "Prepare Recovery Notice", "Prepare General Audit Event"]) {
  if (!workflow.nodes.some((node) => node.name === terminal)) throw new Error("Expected branch node missing: " + terminal);
  workflow.connections[terminal] = { main: [[{ node: "Build Shared Remediation Runbook", type: "main", index: 0 }]] };
}
delete workflow.connections["Build Shared Remediation Runbook"];

if (workflow.nodes.length !== 11) throw new Error("Unexpected workflow node count: " + workflow.nodes.length);
if (!Array.isArray(workflow.connections["Unified Remediation Policy"].main[0])) throw new Error("n8n output connection arrays are malformed.");
if (workflow.connections["Unified Remediation Policy"].main[0][0].node !== "Critical Event?") throw new Error("Policy node is not connected to severity routing.");

fs.writeFileSync(destination, JSON.stringify(workflow, null, 2) + "\n", "utf8");
console.log("WORKFLOW_JSON_VALID nodes=" + workflow.nodes.length + " name=" + workflow.name + " output=" + destination);
