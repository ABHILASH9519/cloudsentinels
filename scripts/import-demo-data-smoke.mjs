import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const identity = process.argv[2];
if (!identity) throw new Error("Pass the test identity name");

const dataset = JSON.parse(
  readFileSync(new URL("../sample-data/demo-observability.json", import.meta.url), "utf8"),
);

function call(method, args = "()") {
  const result = spawnSync(
    "icp",
    ["canister", "call", "--identity", identity, "backend", method, args],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`${method} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function text(value) {
  return JSON.stringify(value);
}

function tuple(...values) {
  return `(${values.map((value) => typeof value === "string" ? text(value) : String(value)).join(", ")})`;
}

function floatLiteral(value) {\n  return Number.isInteger(value) ? `${value}.0` : String(value);\n}\n\nfunction natFrom(result, operation) {
  const match = result.match(/\(\s*(\d+)\s*:\s*nat\s*\)/);
  if (!match) throw new Error(`Could not read the id returned by ${operation}: ${result}`);
  return Number(match[1]);
}

for (const incident of dataset.incidents) {
  const source = `demo/${incident.source}`;
  const id = natFrom(
    call("createIncident", tuple(incident.title, incident.severity, source, incident.rawLog)),
    "createIncident",
  );
  if (incident.status !== "open") {
    call("updateIncidentStatus", `(${id}, ${text(incident.status)})`);
  }
  call(
    "updateIncidentAIFields",
    tuple(id, incident.aiSummary, incident.rootCause, incident.suggestedFix),
  );
}

for (const metric of dataset.metrics) {
  call(
    "addMetric",
    `(${text(metric.name)}, ${floatLiteral(metric.value)}, ${text(metric.unit)}, ${text(`demo/${metric.source}`)})`,
  );
}

for (const alert of dataset.alerts) {
  const id = natFrom(
    call("addAlert", tuple(alert.title, alert.severity, `demo/${alert.source}`, alert.message)),
    "addAlert",
  );
  if (alert.status !== "active") {
    call("updateAlertStatus", `(${id}, ${text(alert.status)})`);
  }
}

const incidents = call("listIncidents");
const metrics = call("getRecentMetrics", "(200 : nat)");
const alerts = call("getAlerts");

for (const incident of dataset.incidents) {
  if (!incidents.includes(incident.title) || !incidents.includes(`demo/${incident.source}`)) {
    throw new Error(`Sample incident was not readable after import: ${incident.title}`);
  }
}
for (const metric of dataset.metrics) {
  if (!metrics.includes(metric.name) || !metrics.includes(`demo/${metric.source}`)) {
    throw new Error(`Sample metric was not readable after import: ${metric.name}`);
  }
}
for (const alert of dataset.alerts) {
  if (!alerts.includes(alert.title) || !alerts.includes(`demo/${alert.source}`)) {
    throw new Error(`Sample alert was not readable after import: ${alert.title}`);
  }
}

console.log(
  `Imported and read back the fixture: ${dataset.incidents.length} incidents, ${dataset.metrics.length} metrics, ${dataset.alerts.length} alerts.`,
);
