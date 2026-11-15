import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Bell, Loader2, RefreshCw, Workflow } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { SeverityBadge } from "../components/SeverityBadge";
import {
  useAutomationCommands,
  useClusterInsights,
  useClusterMonitoring,
  usePlatformStatus,
  useTestZapierWebhook,
  useTriggerClusterAnalysis,
} from "../hooks/useClusterData";

const tooltipStyle = {
  background: "#0b1727",
  border: "1px solid rgba(148,190,213,.2)",
  borderRadius: 10,
  color: "#e8f5fc",
  fontSize: 12,
};

export function MonitoringPage() {
  const monitoring = useClusterMonitoring();
  const insights = useClusterInsights();
  const commands = useAutomationCommands();
  const platform = usePlatformStatus();
  const analyze = useTriggerClusterAnalysis();
  const zapier = useTestZapierWebhook();
  const agents = monitoring.data?.localAgent ?? [];
  const findings = insights.data?.insights ?? [];
  const cpuData = agents.map((agent) => ({
    cluster: agent.context,
    cpu: Number(agent.cpuUsagePercent.toFixed(1)),
  }));
  const memoryData = agents.map((agent) => ({
    cluster: agent.context,
    memory: Number(agent.memoryUsageMB.toFixed(0)),
  }));
  const attention = findings.filter((item) =>
    ["critical", "high", "warning"].includes(item.severity.toLowerCase()),
  );
  const readyNodes = agents.reduce(
    (sum, agent) => sum + agent.readyNodeCount,
    0,
  );
  const totalNodes = agents.reduce((sum, agent) => sum + agent.nodeCount, 0);
  const totalPods = agents.reduce((sum, agent) => sum + agent.podCount, 0);
  const warnings = agents.reduce((sum, agent) => sum + agent.warningEvents, 0);

  const runAnalysis = async () => {
    try {
      const result = await analyze.mutateAsync();
      toast.success(`Analysis completed: ${result.insights.length} findings`);
      await insights.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Analysis failed");
    }
  };
  const testNotification = async () => {
    try {
      await zapier.mutateAsync();
      toast.success("Notification endpoint accepted the test event");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Notification integration is not configured",
      );
    }
  };

  return (
    <div className="mission-page p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-700 text-foreground">
            Monitoring
          </h1>
          <p className="text-sm text-muted-foreground">
            Live local cluster telemetry, alert findings and automation status
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void monitoring.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh metrics
          </Button>
          <Button
            variant="outline"
            onClick={testNotification}
            disabled={
              zapier.isPending ||
              platform.data?.integrations.zapier !== "configured"
            }
          >
            <Bell className="mr-2 h-4 w-4" /> Test notification
          </Button>
          <Button onClick={runAnalysis} disabled={analyze.isPending}>
            {analyze.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Activity className="mr-2 h-4 w-4" />
            )}{" "}
            Run analysis
          </Button>
        </div>
      </div>
      {monitoring.isError && (
        <Card className="border-rose-300/20">
          <CardContent className="p-4 text-sm text-rose-200">
            {monitoring.error instanceof Error
              ? monitoring.error.message
              : "Monitoring API unavailable."}
          </CardContent>
        </Card>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Connected agents",
            value: agents.length,
            note: "Fresh Kubernetes heartbeats",
          },
          {
            label: "Ready nodes",
            value: `${readyNodes}/${totalNodes}`,
            note: "Live node readiness",
          },
          {
            label: "Pods observed",
            value: totalPods,
            note: "Across connected local clusters",
          },
          {
            label: "Warning events",
            value: warnings,
            note: "Kubernetes warning events",
          },
        ].map((item) => (
          <Card key={item.label} className="mission-panel">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{item.label}</div>
              <div className="mt-2 text-2xl font-semibold text-foreground">
                {monitoring.isLoading ? "—" : item.value}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {item.note}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <section className="grid gap-4 xl:grid-cols-2">
        <Card className="telemetry-glass border-cyan-200/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              CPU utilization by cluster
            </CardTitle>
          </CardHeader>
          <CardContent>
            {monitoring.isLoading ? (
              <Skeleton className="h-56" />
            ) : cpuData.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
                Waiting for agent telemetry
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={cpuData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="cluster"
                    tick={{ fill: "#9ca3af", fontSize: 10 }}
                  />
                  <YAxis unit="%" tick={{ fill: "#9ca3af", fontSize: 10 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="cpu"
                    name="CPU %"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card className="telemetry-glass border-cyan-200/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Memory usage by cluster
            </CardTitle>
          </CardHeader>
          <CardContent>
            {monitoring.isLoading ? (
              <Skeleton className="h-56" />
            ) : memoryData.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
                Waiting for agent telemetry
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={memoryData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="cluster"
                    tick={{ fill: "#9ca3af", fontSize: 10 }}
                  />
                  <YAxis unit=" MB" tick={{ fill: "#9ca3af", fontSize: 10 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar
                    dataKey="memory"
                    name="Memory MB"
                    fill="#10b981"
                    radius={[5, 5, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </section>
      <section className="space-y-3">
        <div>
          <h2 className="font-display text-base font-semibold text-foreground">
            Kubernetes agent telemetry
          </h2>
          <p className="text-xs text-muted-foreground">
            Agent readings are separate from Airtable inventory-reported values.
          </p>
        </div>
        {agents.map((agent) => (
          <Card key={agent.clusterId} className="mission-panel">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {agent.context}
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">
                  {agent.collector} · {agent.clusterId}
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>
                  {agent.readyNodeCount}/{agent.nodeCount} nodes ready
                </span>
                <span>
                  {agent.healthyPodCount}/{agent.podCount} healthy pods
                </span>
                <span>{agent.warningEvents} warnings</span>
                <span>{agent.cpuUsagePercent.toFixed(1)}% CPU</span>
                <span>{agent.memoryUsageMB.toFixed(0)} MB</span>
                <span>
                  Seen {new Date(agent.collectedAt).toLocaleTimeString()}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
        {agents.length === 0 && !monitoring.isLoading && (
          <Card className="mission-panel">
            <CardContent className="p-5 text-sm text-muted-foreground">
              No agent heartbeats received in the current API process.
            </CardContent>
          </Card>
        )}
      </section>
      <section className="grid gap-4 xl:grid-cols-2">
        <Card className="mission-panel">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Bell className="h-4 w-4 text-amber-200" /> Alert findings (
              {attention.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {attention.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No warning or critical findings in the current analysis.
              </p>
            ) : (
              attention.map((item) => (
                <div
                  key={item.id}
                  className="border-b border-border/50 pb-3 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={item.severity} />
                    <span className="text-sm font-medium text-foreground">
                      {item.title}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.clusterName} · {item.summary}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {item.requiresApproval
                      ? "Operator approval required"
                      : "Advisory only"}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card className="mission-panel">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Workflow className="h-4 w-4 text-cyan-200" /> Automation command
              queue ({commands.data?.items.length ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(commands.data?.items ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No commands recorded by this API process.
              </p>
            ) : (
              commands.data?.items.slice(0, 8).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 border-b border-border/50 pb-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">
                      {item.action}
                    </div>
                    <div className="truncate text-muted-foreground">
                      {item.clusterId} · {item.approvalStatus}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-muted-foreground">
                    {item.status}
                    <div className="text-[10px]">
                      {new Date(item.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Notification delivery is enabled only when the corresponding integration
        is configured. Current local agents operate in read-only mode; recovery
        mutations require the signed approval path.
      </p>
    </div>
  );
}
