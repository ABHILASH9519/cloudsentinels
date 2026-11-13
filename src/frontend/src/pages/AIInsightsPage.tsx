import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Brain, Lightbulb, ShieldAlert } from "lucide-react";
import { SeverityBadge } from "../components/SeverityBadge";
import { StatusBadge } from "../components/StatusBadge";
import { useClusterInsights } from "../hooks/useClusterData";
import { useListIncidents } from "../hooks/useQueries";

export function AIInsightsPage() {
  const { data: incidents, isLoading } = useListIncidents();
  const clusterInsights = useClusterInsights();
  const withAI = (incidents ?? []).filter((inc) => inc.aiSummary && inc.aiSummary.trim() !== "");
  const insights = clusterInsights.data?.insights ?? [];

  return (
    <div className="mission-page space-y-7 p-6">
      <div>
        <div className="mb-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.2em] text-violet-200/70"><Brain className="h-3.5 w-3.5" /> Explainable infrastructure intelligence</div>
        <h1 className="font-display text-2xl font-bold text-foreground">AI Insights</h1>
        <p className="mt-1 text-sm text-muted-foreground">Cluster health triage, anomaly evidence and recommended next checks.</p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-display text-base font-semibold text-foreground">Cluster intelligence</h2><span className="font-mono text-[9px] text-muted-foreground">{insights.length} FINDINGS</span></div>
        {clusterInsights.isError && <Card className="border-amber-300/20 bg-amber-300/5"><CardContent className="p-4 text-xs text-amber-100/80">{clusterInsights.error instanceof Error ? clusterInsights.error.message : "Cluster insight API is unavailable. Configure the Go API URL."}</CardContent></Card>}
        {clusterInsights.isLoading ? <div className="grid gap-3 md:grid-cols-2">{[1,2].map((i)=><Skeleton key={i} className="h-40" />)}</div> : insights.length === 0 ? <Card className="mission-panel"><CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><ShieldAlert className="h-5 w-5 text-emerald-300" /> No cluster findings from the current inventory snapshot.</CardContent></Card> : (
          <div className="grid gap-3 md:grid-cols-2">
            {insights.map((insight) => (
              <Card key={insight.id} className="mission-panel">
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[9px] uppercase tracking-widest text-cyan-200/70">{insight.clusterName} / {insight.environment}</span><SeverityBadge severity={insight.severity} /></div>
                  <CardTitle className="text-sm">{insight.title}</CardTitle>
                  <p className="text-xs text-muted-foreground">{insight.summary}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div><div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200">Evidence</div><ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{insight.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div>
                  <div><div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200"><Lightbulb className="h-3 w-3" /> Recommended checks</div><ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{insight.recommendedActions.map((item) => <li key={item}>{item}</li>)}</ul></div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2 text-[10px] text-muted-foreground"><span>Heuristic confidence: {(insight.confidence * 100).toFixed(0)}%</span><StatusBadge status={insight.requiresApproval ? "approval required" : "advisory"} /></div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {clusterInsights.data?.disclaimer && <p className="text-[10px] leading-relaxed text-muted-foreground">{clusterInsights.data.disclaimer}</p>}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-base font-semibold text-foreground">Incident AI analysis</h2>
        {isLoading ? <div className="space-y-4">{[1,2,3].map((i)=><Skeleton key={i} className="h-40" />)}</div> : withAI.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card/40 py-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10"><Brain className="h-8 w-8 text-primary" /></div>
            <h3 className="mb-2 font-display text-lg font-semibold text-foreground">No incident AI analysis yet</h3>
            <p className="max-w-sm text-sm text-muted-foreground">Open an incident and request a redacted diagnosis from the configured analysis provider.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {withAI.map((inc) => (
              <Card key={inc.id.toString()} className="mission-panel">
                <CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><CardTitle className="text-sm leading-tight">{inc.title}</CardTitle><div className="flex shrink-0 gap-1.5"><SeverityBadge severity={inc.severity} /><StatusBadge status={inc.status} /></div></div><p className="font-mono text-xs text-muted-foreground">{inc.source}</p></CardHeader>
                <CardContent className="space-y-3">
                  {inc.aiSummary && <div className="flex gap-2"><Brain className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><div className="mb-0.5 text-xs text-primary">Summary</div><p className="text-xs leading-relaxed text-foreground">{inc.aiSummary}</p></div></div>}
                  {inc.rootCause && <div className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" /><div><div className="mb-0.5 text-xs text-amber-400">Root Cause</div><p className="text-xs leading-relaxed text-foreground">{inc.rootCause}</p></div></div>}
                  {inc.suggestedFix && <div className="flex gap-2"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-green-400" /><div><div className="mb-0.5 text-xs text-green-400">Suggested Fix</div><p className="text-xs leading-relaxed text-foreground">{inc.suggestedFix}</p></div></div>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
