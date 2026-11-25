import { cases } from "./catalog.mjs";
function csv(values) {
  return values.map(v => '"' + String(v).replaceAll('"','""') + '"').join(",");
}
console.log("id,notification,diagnostics,proposed_repairs,verification,escalation");
for (const c of cases()) {
  console.log(csv([c.caseId, c.notification, ...["inspect","repair","verify"].map(key =>
    c.steps.map(s => s[key]).join(" | ")), c.escalation]));
}
