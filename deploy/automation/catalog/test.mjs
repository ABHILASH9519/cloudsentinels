import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { cases, signals } from "./catalog.mjs";
const workflow = JSON.parse(readFileSync(new URL("../n8n-cloudsentinels-unified.json", import.meta.url)));
const source = workflow.nodes.find(n => n.name === "Build Shared Remediation Runbook").parameters.jsCode;
const run = new Function("$input", source);
const execute = event => run({first:()=>({json:event})})[0].json.sharedRemediationProcedure;
const base = {eventId:"now",sourceType:"kubernetes-agent",clusterId:"local",severity:"high",eventType:"kubernetes.warning",occurredAt:"2026-11-25T12:00:00Z"};
const found = new Set();
const sample = s => ({...base,summary:s.phrases[0]});
for (const c of cases()) {
  const [a,b] = c.steps;
  const event = sample(a);
  if (b) event.catalogRecent = [{signalId:b.id,clusterId:"local",eventId:"earlier",occurredAt:"2026-11-25T11:59:00Z",resourceName:"peer"}];
  const result = execute(event);
  assert.equal(result.catalog.caseId,c.caseId);
  assert.equal(result.executionStatus,"NOT_EXECUTED");
  assert.equal(result.verificationSteps.length,c.steps.length);
  assert.equal(result.proposedRepairs.length,c.steps.length);
  assert.ok(result.notification);
  assert.equal(result.mutationActions.length,0);
  found.add(result.catalog.caseId);
}
assert.equal(found.size,signals.length*(signals.length+1)/2);
assert.ok(found.size > 5000);
assert.equal(execute({...base,summary:"unknown warning"}).catalog.caseId,"cs/unclassified");
assert.equal(execute({...base,eventType:"kubernetes.normal",severity:"info"}).catalog.caseId,"cs/activity");
const target = sample(signals[0]);
for (const earlier of [
  {clusterId:"another-cluster",occurredAt:"2026-11-25T11:59:00Z"},
  {clusterId:"local",occurredAt:"2026-11-25T11:00:00Z"},
  {clusterId:"local",occurredAt:"2026-11-25T12:01:00Z"},
]) {
  const result = execute({...target,catalogRecent:[{...earlier,eventId:"previous",signalId:signals[1].id}]});
  assert.equal(result.catalog.steps.length,1);
}
console.log("Verified " + found.size + " unique cases in the generated n8n runbook node");

const normalize = workflow.nodes.find(n => n.name === "Validate and Normalize Event").parameters.jsCode;
const normalizeEvent = new Function("$input", normalize);
const paired = {...target,catalogRecent:[{clusterId:"local",occurredAt:"2026-11-25T11:59:00Z",eventId:"previous",signalId:signals[1].id}]};
const normalized = normalizeEvent({all:()=>[{json:{body:paired}}]})[0].json;
assert.equal(execute(normalized).catalog.steps.length,2);
console.log("Verified correlation metadata survives n8n event normalization");
