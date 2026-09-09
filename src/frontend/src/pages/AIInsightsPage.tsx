import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Brain, Lightbulb } from "lucide-react";
import { SeverityBadge } from "../components/SeverityBadge";
import { StatusBadge } from "../components/StatusBadge";
import { useListIncidents } from "../hooks/useQueries";

export function AIInsightsPage() {
  const { data: incidents, isLoading } = useListIncidents();

  const withAI = (incidents ?? []).filter(
    (inc) => inc.aiSummary && inc.aiSummary.trim() !== "",
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="font-display text-2xl font-700 text-foreground">
          AI Insights
        </h1>
        <p className="text-sm text-muted-foreground">
          {withAI.length} incident{withAI.length !== 1 ? "s" : ""} with AI
          analysis
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4" data-ocid="ai_insights.loading_state">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : withAI.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-24 text-center"
          data-ocid="ai_insights.empty_state"
        >
          <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
            <Brain className="w-8 h-8 text-primary" />
          </div>
          <h2 className="font-display text-lg font-600 text-foreground mb-2">
            No AI Analysis Yet
          </h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Create incidents and populate AI fields via the Incident Detail page
            or your Python backend pushing analysis results.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {withAI.map((inc, i) => (
            <Card
              key={inc.id.toString()}
              data-ocid={`ai_insights.item.${i + 1}`}
              className="bg-card border-border hover:border-primary/30 transition-colors"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-sm font-semibold text-foreground leading-tight">
                    {inc.title}
                  </CardTitle>
                  <div className="flex gap-1.5 shrink-0">
                    <SeverityBadge severity={inc.severity} />
                    <StatusBadge status={inc.status} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground font-mono">
                  {inc.source}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {inc.aiSummary && (
                  <div className="flex gap-2">
                    <Brain className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs text-primary mb-0.5">Summary</div>
                      <p className="text-xs text-foreground leading-relaxed">
                        {inc.aiSummary}
                      </p>
                    </div>
                  </div>
                )}
                {inc.rootCause && (
                  <div className="flex gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs text-amber-400 mb-0.5">
                        Root Cause
                      </div>
                      <p className="text-xs text-foreground leading-relaxed">
                        {inc.rootCause}
                      </p>
                    </div>
                  </div>
                )}
                {inc.suggestedFix && (
                  <div className="flex gap-2">
                    <Lightbulb className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs text-green-400 mb-0.5">
                        Suggested Fix
                      </div>
                      <p className="text-xs text-foreground leading-relaxed">
                        {inc.suggestedFix}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
