import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  Brain,
  Lightbulb,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { SeverityBadge } from "../components/SeverityBadge";
import { StatusBadge } from "../components/StatusBadge";
import {
  useClusterInsights,
  useTriggerClusterAnalysis,
} from "../hooks/useClusterData";

export function AIInsightsPage() {
  const report = useClusterInsights();
  const analyze = useTriggerClusterAnalysis();
  const insights = report.data?.insights ?? [];
  const runAnalysis = async () => {
    try {
      const result = await analyze.mutateAsync();
      toast.success(`Analysis completed: ${result.insights.length} findings`);
      await report.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Cluster analysis failed",
      );
    }
  };

  return (
    <div className="mission-page space-y-7 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.2em] text-violet-200/70">
            <Brain className="h-3.5 w-3.5" /> Explainable infrastructure
            intelligence
          </div>
          <h1 className="font-display text-2xl font-bold text-foreground">
            AI Insights
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cluster health triage, anomaly evidence and recommended next checks.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void report.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button
            onClick={() => void runAnalysis()}
            disabled={analyze.isPending}
          >
            {analyze.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Brain className="mr-2 h-4 w-4" />
            )}{" "}
            Run cluster analysis
          </Button>
        </div>
      </div>
      {report.isError && (
        <Card className="border-amber-300/20 bg-amber-300/5">
          <CardContent className="p-4 text-xs text-amber-100/80">
            {report.error instanceof Error
              ? report.error.message
              : "Cluster insight API is unavailable."}
          </CardContent>
        </Card>
      )}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-foreground">
            Cluster intelligence
          </h2>
          <span className="font-mono text-[9px] text-muted-foreground">
            {insights.length} FINDINGS
          </span>
        </div>
        {report.isLoading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        ) : insights.length === 0 ? (
          <Card className="mission-panel">
            <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
              <ShieldAlert className="h-5 w-5 text-emerald-300" /> No cluster
              findings from the current inventory snapshot. Run analysis to
              refresh the assessment.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {insights.map((insight) => (
              <Card key={insight.id} className="mission-panel">
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[9px] uppercase tracking-widest text-cyan-200/70">
                      {insight.clusterName} / {insight.environment}
                    </span>
                    <SeverityBadge severity={insight.severity} />
                  </div>
                  <CardTitle className="text-sm">{insight.title}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {insight.summary}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200">
                      Evidence
                    </div>
                    <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                      {insight.evidence.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                      <Lightbulb className="h-3 w-3" /> Recommended checks
                    </div>
                    <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                      {insight.recommendedActions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
                    <span>
                      Heuristic confidence:{" "}
                      {(insight.confidence * 100).toFixed(0)}%
                    </span>
                    <StatusBadge
                      status={
                        insight.requiresApproval
                          ? "approval required"
                          : "advisory"
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
      {report.data?.disclaimer && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {report.data.disclaimer}
        </p>
      )}
      <Card className="border-violet-300/20 bg-violet-300/[.035]">
        <CardContent className="flex gap-3 p-4 text-xs text-muted-foreground">
          <AlertCircle className="h-4 w-4 shrink-0 text-violet-200" />
          <p>
            The current AI analysis is an explainable deterministic rules
            engine, not a trained ML model or external LLM. It reports evidence
            and safe recommendations; it does not execute remediation.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
