import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, BrainCircuit, Lightbulb, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useClusterInsights, useTriggerClusterAnalysis } from "../hooks/useClusterData";

export function LocalDemoAIInsightsPage() {
  const insights = useClusterInsights();
  const analyze = useTriggerClusterAnalysis();
  const runAnalysis = async () => {
    try {
      const report = await analyze.mutateAsync();
      toast.success(`Analysis completed: ${report.insights.length} findings`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Analysis failed");
    }
  };
  return (
    <div className="mission-page space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.2em] text-violet-200/70"><BrainCircuit className="h-3.5 w-3.5" /> Explainable infrastructure intelligence</div>
          <h1 className="font-display text-2xl font-bold text-foreground">AI Insights</h1>
          <p className="mt-1 text-sm text-muted-foreground">Evidence-based cluster triage with recommended checks and explicit approval boundaries.</p>
        </div>
        <Button onClick={runAnalysis} disabled={analyze.isPending}><RefreshCw className={`mr-2 h-4 w-4 ${analyze.isPending ? "animate-spin" : ""}`} />{analyze.isPending ? "Analyzing…" : "Run analysis"}</Button>
      </div>
      <Card className="border-violet-300/20 bg-violet-300/[.035]"><CardContent className="flex gap-3 p-4"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-violet-200" /><p className="text-xs leading-relaxed text-muted-foreground">This build uses a deterministic, explainable rules engine—not a trained ML model or generative AI service. Findings are advisory and do not execute remediation.</p></CardContent></Card>
      {insights.isError && <Card className="border-rose-300/20"><CardContent className="p-4 text-sm text-rose-200">{insights.error instanceof Error ? insights.error.message : "AI analysis API unavailable."}</CardContent></Card>}
      <div className="flex items-center justify-between"><h2 className="font-display text-base font-semibold text-foreground">Cluster findings</h2><span className="font-mono text-[10px] text-muted-foreground">{insights.data?.insights.length ?? 0} FINDINGS</span></div>
      {insights.isLoading ? <Card className="mission-panel"><CardContent className="p-6 text-sm text-muted-foreground">Loading analysis…</CardContent></Card> : (insights.data?.insights ?? []).length === 0 ? <Card className="mission-panel"><CardContent className="p-8 text-center text-sm text-muted-foreground">No findings for the current inventory snapshot.</CardContent></Card> : <div className="grid gap-3 lg:grid-cols-2">{insights.data?.insights.map((item) => <Card key={item.id} className="mission-panel"><CardHeader className="pb-2"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[9px] uppercase tracking-widest text-cyan-200/70">{item.clusterName} / {item.environment}</span><span className={`rounded-full border px-2 py-1 font-mono text-[10px] uppercase ${item.severity === "critical" || item.severity === "high" ? "border-rose-300/20 bg-rose-300/5 text-rose-200" : "border-amber-300/20 bg-amber-300/5 text-amber-100"}`}>{item.severity}</span></div><CardTitle className="text-sm">{item.title}</CardTitle><p className="text-xs text-muted-foreground">{item.summary}</p></CardHeader><CardContent className="space-y-3"><div><div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200">Evidence</div><ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{item.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul></div><div><div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200"><Lightbulb className="h-3 w-3" /> Recommended checks</div><ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{item.recommendedActions.map((action) => <li key={action}>{action}</li>)}</ul></div><div className="flex items-center justify-between border-t border-border/50 pt-2 text-[10px] text-muted-foreground"><span>Rules confidence: {(item.confidence * 100).toFixed(0)}%</span><span>{item.requiresApproval ? "Approval required for action" : "Advisory only"}</span></div></CardContent></Card>)}</div>}
      {insights.data?.disclaimer && <p className="text-[10px] leading-relaxed text-muted-foreground">{insights.data.disclaimer}</p>}
    </div>
  );
}
