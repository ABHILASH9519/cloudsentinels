const e = $input.first().json;
const type = String(e.eventType || "").toLowerCase();
const source = String(e.sourceType || "").toLowerCase();
const text = [type, source, e.title, e.summary, e.service, e.resourceId, e.resourceState].join(" ").toLowerCase();

let target = "cloudsentinels-core";
let adapter = "core-incident-policy";
let actions = [];
let mutationActions = [];
let status = "observe-and-audit";
let reason = "Event is recorded and triaged; no target-specific mutation adapter is selected.";

if (/lambda|serverless/.test(text)) {
  target = "aws-lambda";
  adapter = "aws-lambda-readonly";
  actions = ["inspect-errors", "inspect-throttles", "inspect-duration", "inspect-logs", "check-concurrency"];
  status = "manual-review";
  reason = "Lambda diagnostics are supported by monitoring; version-alias rollback or configuration changes are not enabled in this workflow.";
} else if (/ec2|aws-server|instance-state|status-check|cpu-high/.test(text)) {
  target = "aws-ec2";
  adapter = "aws-ec2-readonly";
  actions = ["inspect-instance-state", "inspect-status-checks", "inspect-cpu-metrics", "inspect-system-logs"];
  status = "manual-review";
  reason = "EC2 monitoring is read-only. SSM access and an approved instance remediation adapter are not yet configured.";
} else if (/n8n-delivery|dlq|dead.?letter|eventbridge/.test(text)) {
  target = "aws-event-pipeline";
  adapter = "aws-sqs-readonly";
  actions = ["inspect-eventbridge-rules", "inspect-sqs-queue-age", "inspect-delivery-dlq"];
  status = "manual-review";
  reason = "AWS event delivery diagnostics are available; queue purging, target rewiring and retry-policy changes require separate operator approval.";
} else if (/kubernetes|k8s|podcrashloop|deploymentunhealthy|nodenotready|memorypressure|cputhreshold/.test(text)) {
  target = "kubernetes";
  adapter = "cloudsentinels-agent";
  actions = ["collect-snapshot"];
  status = "diagnostic-ready";
  reason = "The authenticated local agent can collect a cluster snapshot. Mutating commands remain allowlisted and approval-gated.";
  if (type.includes("deploymentunhealthy") && e.namespace && e.resourceName) {
    actions.push("rollout-status");
    mutationActions = ["restart-deployment", "rollback-deployment"];
    actions.push(...mutationActions);
    status = "approval-required";
    reason = "A specific deployment was identified. Restart or rollback can only be queued after signed human approval and is limited by the agent action and namespace allowlists.";
  } else if (type.includes("podcrashloop")) {
    actions.push("rollout-status");
    reason = "Capture diagnostics and identify the owning deployment before any restart; the event identifies a pod, not a safe deployment target.";
  } else if (type.includes("nodenotready") || type.includes("memorypressure")) {
    reason = "Capture diagnostics and escalate. Node drain, eviction, and destructive node operations are not in the agent allowlist.";
  }
} else if (/guardduty|securityhub|threat|security|unauthorized|credential|intrusion|malware/.test(text)) {
  target = "security-event";
  adapter = "security-evidence-review";
  actions = ["preserve-event-evidence", "review-cloudtrail-and-guardduty", "human-containment-review"];
  status = "security-review-required";
  reason = "Security events are escalated for human investigation; automatic isolation or credential changes are deliberately disabled.";
}

const lifecycle = [
  "ingest-and-authenticate",
  "normalize-and-validate",
  "correlate-and-deduplicate-by-event-id",
  "classify-severity-and-target",
  "collect-read-only-diagnostics",
  "evaluate-target-specific-allowlist",
  "require-signed-human-approval-for-mutations",
  "execute-only-through-authorized-target-adapter",
  "verify-health-and-rollout",
  "rollback-or-escalate-on-verification-failure",
  "write-audit-and-recovery-event"
];

return [{json:{
  ...e,
  target,
  remediation: {
    target,
    adapter,
    status,
    reason,
    recommendedActions: actions,
    mutationActions,
    requiresHumanApproval: mutationActions.length > 0 || status === "manual-review" || status === "security-review-required",
    canExecuteFromN8n: false,
    remediationExecuted: false,
    idempotencyKey: e.eventId
  },
  sharedLifecycle: lifecycle,
  remediationExecuted: false
}}];
