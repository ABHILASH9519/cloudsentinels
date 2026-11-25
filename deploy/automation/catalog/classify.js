function classify(event) {
  if (!event.clusterId || event.sourceType !== "kubernetes-agent") return null;
  if (event.eventType === "kubernetes.normal") {
    return {caseId:"cs/activity", lifecycle:"activity", steps:[], notification:event.title,
      verification:"Normal activity alone does not close an incident."};
  }
  if (event.severity === "info" || event.eventType.includes("recover")) return null;
  const text = [event.summary, event.title, event.eventType].join(" ").toLowerCase();
  const ranked = catalog.map(s => ({s, score: Math.max(0,...s.phrases.filter(p => text.includes(p)).map(p => p.length))}))
    .filter(m => m.score).sort((a,b) => b.score-a.score);
  if (!ranked.length) return {caseId:"cs/unclassified", lifecycle:"triage", steps:[],
    notification:event.title, diagnostic:"Inspect the original Event and affected resource conditions.",
    proposedRepair:"Escalate to the resource owner after confirming the cause.",
    verification:"Check resource conditions and whether the warning recurs."};
  const primary = ranked[0].s;
  const evidence = {eventId:event.eventId, clusterId:event.clusterId, namespace:event.namespace || "",
    resourceKind:event.resourceKind || "", resourceName:event.resourceName || "", occurredAt:event.occurredAt, signalId:primary.id};
  const steps = [{...primary, evidence}];
  for (const previous of Array.isArray(event.catalogRecent) ? event.catalogRecent.slice(0,4) : []) {
    const age = Date.parse(event.occurredAt) - Date.parse(previous.occurredAt);
    const companion = catalog.find(s => s.id === previous.signalId);
    if (companion && companion.id !== primary.id && previous.clusterId === event.clusterId &&
        previous.eventId !== event.eventId && age >= 0 && age <= 600000) {
      steps.push({...companion, evidence:previous});
      break;
    }
  }
  const ids = steps.map(s => s.id).sort();
  return {caseId:"cs/"+ids.join("+"), primaryEvidence:evidence, lifecycle:"open",
    notification:event.clusterId+" · "+ids.join(" + ")+" · "+(event.resourceName || event.eventType),
    steps:steps.map(({id,inspect,repair,verify,evidence}) => ({id,inspect,proposedRepair:repair,verify,evidence})),
    escalation:"Keep the incident open if verification fails and escalate to the resource owner."};
}
