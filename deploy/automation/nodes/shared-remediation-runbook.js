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
const incidentCase = classify(e);
if (incidentCase) {
  procedure.catalog = incidentCase;
  procedure.status = incidentCase.lifecycle === "activity" ? "observe-and-audit" : "diagnostic-ready";
  procedure.priority = ({critical:"P1",high:"P2",warning:"P3",medium:"P3",degraded:"P3"})[e.severity] || "P4";
  procedure.notification = incidentCase.notification;
  procedure.mutationActions = [];
  procedure.requiresHumanApproval = incidentCase.lifecycle !== "activity";
  if (incidentCase.steps.length) {
    procedure.recommendedActions = incidentCase.steps.map(s => s.inspect);
    procedure.proposedRepairs = incidentCase.steps.map(s => s.proposedRepair);
    procedure.verificationSteps = incidentCase.steps.map(s => s.verify);
  } else {
    procedure.recommendedActions = incidentCase.diagnostic ? [incidentCase.diagnostic] : [];
    procedure.proposedRepairs = incidentCase.proposedRepair ? [incidentCase.proposedRepair] : [];
    procedure.verificationSteps = [incidentCase.verification];
  }
}
return [{json:{...e, sharedRemediationProcedure:procedure, remediationExecuted:false}}];
