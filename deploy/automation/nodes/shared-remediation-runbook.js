const e = $input.first().json;
const r = e.remediation || {};
const procedure = {
  incidentId: e.eventId,
  target: r.target || "cloudsentinels-core",
  adapter: r.adapter || "core-incident-policy",
  severity: e.severity || "info",
  priority: e.triage?.priority || "P4",
  status: r.status || "observe-and-audit",
  reason: r.reason || "No remediation rule matched.",
  recommendedActions: r.recommendedActions || [],
  mutationActions: r.mutationActions || [],
  requiresHumanApproval: Boolean(r.requiresHumanApproval),
  executionBoundary: "n8n-plans-only; CloudSentinels API and target agent enforce authorization",
  executionStatus: "NOT_EXECUTED",
  verificationRequired: true,
  failurePath: "retain-evidence-and-escalate",
  audit: {
    eventId: e.eventId,
    sourceType: e.sourceType || "unknown",
    clusterId: e.clusterId || null,
    region: e.region || null,
    resourceId: e.resourceId || null,
    resourceKind: e.resourceKind || null,
    resourceName: e.resourceName || null,
    namespace: e.namespace || null
  }
};
return [{json:{...e, sharedRemediationProcedure:procedure, remediationExecuted:false}}];
