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
const newAllowlist = "const allowed = ['schemaVersion','eventId','eventType','occurredAt','clusterId','clusterName','sourceType','environment','severity','title','summary','resourceId','resourceKind','resourceName','namespace','region','service','accountId','action','resourceState','functionName','alarmName'];";
if (!normalize.parameters.jsCode.includes(oldAllowlist)) throw new Error("Base event allowlist did not match expected version.");
normalize.parameters.jsCode = normalize.parameters.jsCode.replace(oldAllowlist, newAllowlist);

const bodyLine = "let body = root.body !== undefined ? parseObject(root.body, 'request body') : root;";
if (!normalize.parameters.jsCode.includes(bodyLine)) throw new Error("Webhook body parser anchor did not match expected version.");
const eventBridgeNormalize = fs.readFileSync(path.join(nodesDir, "eventbridge-normalize.js"), "utf8");
normalize.parameters.jsCode = normalize.parameters.jsCode.replace(bodyLine, bodyLine + "\n" + eventBridgeNormalize);

const awsEventBridgeCode = fs.readFileSync(path.join(nodesDir, "aws-eventbridge-connector.js"), "utf8");
const awsLambdaCode = fs.readFileSync(path.join(nodesDir, "aws-lambda-serverless-connector.js"), "utf8");
const dockerDesktopCode = fs.readFileSync(path.join(nodesDir, "docker-desktop-kubernetes-connector.js"), "utf8");
const minikubeCode = fs.readFileSync(path.join(nodesDir, "minikube-kubernetes-connector.js"), "utf8");
const policyCode = fs.readFileSync(path.join(nodesDir, "unified-remediation-policy.js"), "utf8");
const runbookCode = fs.readFileSync(path.join(nodesDir, "shared-remediation-runbook.js"), "utf8");

const codeNode = (id, name, jsCode, position) => ({
  parameters: { mode: "runOnceForAllItems", jsCode },
  id, name, type: "n8n-nodes-base.code", typeVersion: 2, position
});
const awsEventBridgeNode = codeNode(
  "f7b8d32e-7d25-4e3f-9e21-7e8e3e4a1003",
  "AWS EventBridge / SQS Connector",
  awsEventBridgeCode,
  [760, 300]
);
const awsLambdaNode = codeNode(
  "f7b8d32e-7d25-4e3f-9e21-7e8e3e4a1004",
  "AWS Lambda / Serverless Connector",
  awsLambdaCode,
  [1020, 300]
);
const dockerDesktopNode = codeNode(
  "f7b8d32e-7d25-4e3f-9e21-7e8e3e4a1005",
  "Docker Desktop Kubernetes Connector",
  dockerDesktopCode,
  [1540, 300]
);
const minikubeNode = codeNode(
  "f7b8d32e-7d25-4e3f-9e21-7e8e3e4a1006",
  "Local Minikube Kubernetes Connector",
  minikubeCode,
  [1800, 300]
);
const policyNode = codeNode(
  "f7b8d32e-7d25-4e3f-9e21-7e8e3e4a1001",
  "Unified Remediation Policy",
  policyCode,
  [1280, 300]
);
const runbookNode = codeNode(
  "f7b8d32e-7d25-4e3f-9e21-7e8e3e4a1002",
  "Build Shared Remediation Runbook",
  runbookCode,
  [2580, 300]
);

workflow.nodes = workflow.nodes.filter((node) => ![
  "AWS EventBridge / SQS Connector",
  "AWS Lambda / Serverless Connector",
  "Docker Desktop Kubernetes Connector",
  "Local Minikube Kubernetes Connector",
  "Unified Remediation Policy",
  "Build Shared Remediation Runbook"
].includes(node.name));
workflow.nodes.push(awsEventBridgeNode, awsLambdaNode, dockerDesktopNode, minikubeNode, policyNode, runbookNode);

// Lay out all four provider/cluster adapters visibly on the single shared main path.
const positions = {
  "CloudSentinels Event Webhook": [240, 300],
  "Validate and Normalize Event": [500, 300],
  "AWS EventBridge / SQS Connector": [760, 300],
  "AWS Lambda / Serverless Connector": [1020, 300],
  "Docker Desktop Kubernetes Connector": [1280, 300],
  "Local Minikube Kubernetes Connector": [1540, 300],
  "Unified Remediation Policy": [1800, 300],
  "Critical Event?": [2060, 300],
  "Prepare Critical Alert": [2320, 80],
  "Degraded Event?": [2320, 400],
  "Prepare Degraded Alert": [2580, 200],
  "Recovery Event?": [2580, 520],
  "Prepare Recovery Notice": [2840, 400],
  "Prepare General Audit Event": [2840, 620],
  "Build Shared Remediation Runbook": [3100, 300]
};
for (const node of workflow.nodes) {
  if (positions[node.name]) node.position = positions[node.name];
}

workflow.connections["Validate and Normalize Event"] = {
  main: [[{ node: "AWS EventBridge / SQS Connector", type: "main", index: 0 }]]
};
workflow.connections["AWS EventBridge / SQS Connector"] = {
  main: [[{ node: "AWS Lambda / Serverless Connector", type: "main", index: 0 }]]
};
workflow.connections["AWS Lambda / Serverless Connector"] = {
  main: [[{ node: "Docker Desktop Kubernetes Connector", type: "main", index: 0 }]]
};
workflow.connections["Docker Desktop Kubernetes Connector"] = {
  main: [[{ node: "Local Minikube Kubernetes Connector", type: "main", index: 0 }]]
};
workflow.connections["Local Minikube Kubernetes Connector"] = {
  main: [[{ node: "Unified Remediation Policy", type: "main", index: 0 }]]
};
workflow.connections["Unified Remediation Policy"] = {
  main: [[{ node: "Critical Event?", type: "main", index: 0 }]]
};
for (const terminal of ["Prepare Critical Alert", "Prepare Degraded Alert", "Prepare Recovery Notice", "Prepare General Audit Event"]) {
  if (!workflow.nodes.some((node) => node.name === terminal)) throw new Error("Expected branch node missing: " + terminal);
  workflow.connections[terminal] = { main: [[{ node: "Build Shared Remediation Runbook", type: "main", index: 0 }]] };
}
delete workflow.connections["Build Shared Remediation Runbook"];

if (workflow.nodes.length !== 15) throw new Error("Unexpected workflow node count: " + workflow.nodes.length);
const expected = [
  ["Validate and Normalize Event", "AWS EventBridge / SQS Connector"],
  ["AWS EventBridge / SQS Connector", "AWS Lambda / Serverless Connector"],
  ["AWS Lambda / Serverless Connector", "Docker Desktop Kubernetes Connector"],
  ["Docker Desktop Kubernetes Connector", "Local Minikube Kubernetes Connector"],
  ["Local Minikube Kubernetes Connector", "Unified Remediation Policy"],
  ["Unified Remediation Policy", "Critical Event?"]
];
for (const [from, to] of expected) {
  if (workflow.connections[from]?.main?.[0]?.[0]?.node !== to) throw new Error("Broken main-path connection: " + from + " -> " + to);
}
for (const terminal of ["Prepare Critical Alert", "Prepare Degraded Alert", "Prepare Recovery Notice", "Prepare General Audit Event"]) {
  if (workflow.connections[terminal]?.main?.[0]?.[0]?.node !== "Build Shared Remediation Runbook") {
    throw new Error("Broken shared-runbook connection from " + terminal);
  }
}

fs.writeFileSync(destination, JSON.stringify(workflow, null, 2) + "\n", "utf8");
console.log("WORKFLOW_JSON_VALID nodes=" + workflow.nodes.length + " name=" + workflow.name + " output=" + destination);
