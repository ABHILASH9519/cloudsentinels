import { readFileSync } from "node:fs";
export const signals = readFileSync(new URL("signals.tsv", import.meta.url), "utf8")
  .trim().split("\n").slice(1).map(line => {
    const [id, phrases, inspect, repair, verify] = line.split("\t");
    if (!id || !phrases || !inspect || !repair || !verify) throw new Error("Invalid signal: " + id);
    return { id, phrases: phrases.split("|"), inspect, repair, verify };
  });
if (new Set(signals.map(s => s.id)).size !== signals.length) throw new Error("Duplicate signals");
export const caseId = ids => "cs/" + [...ids].sort().join("+");
export function* cases() {
  for (let i = 0; i < signals.length; i++) {
    for (let j = i; j < signals.length; j++) {
      const steps = i === j ? [signals[i]] : [signals[i], signals[j]];
      yield { caseId: caseId(steps.map(s => s.id)), notification: steps.map(s => s.id).join(" + "),
        steps, escalation: "Keep incident open and escalate to the resource owner if verification fails." };
    }
  }
}
