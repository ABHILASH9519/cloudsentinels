import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SeverityBadge } from "../components/SeverityBadge";
import {
  useAutomationCommands,
  useClusterInsights,
  useClusterInventory,
  useClusterMonitoring,
  usePlatformStatus,
} from "../hooks/useClusterData";

const PIE_COLORS = ["#67e8f9", "#fbbf24", "#4ade80", "#fb7185", "#a78bfa"];
const panelTooltip = {
  background: "#0b1727",
  border: "1px solid rgba(148,190,213,.2)",
  borderRadius: 10,
  color: "#e8f5fc",
  fontSize: 12,
};

function formatUpdatedAt(value?: string) {
  if (!value) return "Waiting for first heartbeat";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function DashboardPage() {
  const inventory = useClusterInventory();
  const monitoring = useClusterMonitoring();
  const insights = useClusterInsights();
  const commands = useAutomationCommands();
  const platform = usePlatformStatus();
  const clusters = inventory.data?.clusters ?? [];
  const agents = monitoring.data?.localAgent ?? [];
  const findings = insights.data?.insights ?? [];
  const connectedAgents = agents.filter(
    (agent) => Date.now() - new Date(agent.collectedAt).getTime() < 120000,
  );
  const readyNodes = agents.reduce(
    (sum, agent) => sum + agent.readyNodeCount,
    0,
  );
  const podCount = agents.reduce((sum, agent) => sum + agent.podCount, 0);
  const warningEvents = agents.reduce(
    (sum, agent) => sum + agent.warningEvents,
    0,
  );
  const criticalFindings = findings.filter((item) =>
    ["critical", "high"].includes(item.severity.toLowerCase()),
  );
  const healthChartData = [
    "Healthy",
    "Warning",
    "Critical",
    "Offline",
    "Unknown",
  ]
    .map((name) => ({
      name,
      value: clusters.filter(
        (cluster) => cluster.healthStatus.toLowerCase() === name.toLowerCase(),
      ).length,
    }))
    .filter((item) => item.value > 0);
  const severityChartData = ["critical", "high", "medium", "low", "info"]
    .map((name) => ({
      name,
      value: findings.filter((item) => item.severity.toLowerCase() === name)
        .length,
    }))
    .filter((item) => item.value > 0);
  const cpuChartData = agents.map((agent) => ({
    cluster: agent.context,
    cpu: Number(agent.cpuUsagePercent.toFixed(1)),
  }));
  const updatedAt = agents
    .map((agent) => agent.collectedAt)
    .sort()
    .at(-1);
  const loading =
    inventory.isLoading || monitoring.isLoading || insights.isLoading;
  const failed = inventory.isError || monitoring.isError || insights.isError;
  const stats = [
    {
      label: "Inventory clusters",
      value: inventory.data?.count ?? "—",
      note: "Airtable source records",
      icon: Server,
    },
    {
      label: "Connected agents",
      value: connectedAgents.length,
      note: "Fresh Kubernetes heartbeats",
      icon: Radio,
    },
    {
      label: "Ready nodes / pods",
      value: `${readyNodes} / ${podCount}`,
      note: "Live local telemetry",
      icon: Activity,
    },
    {
      label: "High / critical findings",
      value: criticalFindings.length,
      note: "Explainable rule-engine output",
      icon: ShieldCheck,
    },
  ];

  return (
    <div className="mission-page dashboard-page">
      <div className="dashboard-shell">
        <section className="dashboard-heading">
          <div>
            <div className="dashboard-eyebrow">
              <span /> CLOUD OPERATIONS / OVERVIEW
            </div>
            <h1>
              Mission control<span>.</span>
            </h1>
            <p>
              Live cluster telemetry, explainable findings and approval-gated
              response activity.
            </p>
          </div>
          <output
            className={
              failed
                ? "dashboard-state dashboard-state-error"
                : loading
                  ? "dashboard-state dashboard-state-loading"
                  : "dashboard-state dashboard-state-live"
            }
            aria-live="polite"
          >
            <span className="dashboard-state-dot" />
            <span>
              {failed
                ? "API connection issue"
                : loading
                  ? "Synchronizing"
                  : "Telemetry received"}
            </span>
            <span className="dashboard-state-divider" />
            <span className="dashboard-state-meta">LOCAL GO CONTROL PLANE</span>
          </output>
        </section>

        <section className="dashboard-orbit-panel">
          <div className="dashboard-orbit-copy">
            <div className="dashboard-orbit-kicker">
              <Radio className="h-3.5 w-3.5" /> AUTONOMOUS DEFENSE SYSTEM
            </div>
            <h2>
              See the signal.
              <br />
              <em>Stay ahead of the incident.</em>
            </h2>
            <p>
              Observe infrastructure, analyze signals, and prepare safe recovery
              actions across local clusters and hosted execution adapters.
            </p>
            <div className="dashboard-orbit-meta">
              <span>
                <span className="dashboard-mini-dot" /> OBSERVE
              </span>
              <span>
                <span className="dashboard-mini-dot" /> ANALYZE
              </span>
              <span>
                <span className="dashboard-mini-dot" /> RESPOND
              </span>
            </div>
          </div>
          <div className="dashboard-orbit-art" aria-hidden="true">
            <div className="dashboard-orbit-ring dashboard-orbit-ring-outer" />
            <div className="dashboard-orbit-ring dashboard-orbit-ring-middle" />
            <div className="dashboard-orbit-ring dashboard-orbit-ring-inner" />
            <div className="dashboard-planet">
              <span className="dashboard-planet-glow" />
            </div>
            <div className="dashboard-orbit-satellite">
              <span />
            </div>
            <div className="dashboard-orbit-crosshair dashboard-orbit-crosshair-one" />
            <div className="dashboard-orbit-crosshair dashboard-orbit-crosshair-two" />
          </div>
          <div className="dashboard-orbit-footer">
            <span>CS / LIVE TELEMETRY</span>
            <span>REGION · LOCAL REVIEW</span>
            <span>MODE · READ-ONLY OBSERVATION</span>
          </div>
        </section>

        <section className="dashboard-section-heading">
          <div>
            <div className="dashboard-section-kicker">SYSTEM SNAPSHOT</div>
            <h2>Infrastructure at a glance</h2>
          </div>
          <div className="dashboard-updated">
            <Clock3 className="h-3.5 w-3.5" /> {formatUpdatedAt(updatedAt)}
          </div>
        </section>
        {failed && (
          <div role="alert" className="dashboard-error">
            <div>
              <p className="font-semibold">
                Unable to retrieve cluster telemetry
              </p>
              <p>
                {inventory.error instanceof Error
                  ? inventory.error.message
                  : monitoring.error instanceof Error
                    ? monitoring.error.message
                    : "Check the local Go API and Firebase session."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void inventory.refetch();
                void monitoring.refetch();
                void insights.refetch();
              }}
            >
              <RefreshCw className="h-4 w-4" /> Retry sync
            </button>
          </div>
        )}

        <section className="dashboard-stats-grid" aria-label="Cluster metrics">
          {stats.map((stat, index) => (
            <Card
              key={stat.label}
              className="dashboard-stat-card"
              style={{ animationDelay: `${index * 70}ms` }}
            >
              <CardContent className="dashboard-stat-content">
                <div className="dashboard-stat-topline">
                  <span>{stat.label}</span>
                  <span className="dashboard-stat-icon">
                    <stat.icon className="h-[17px] w-[17px]" />
                  </span>
                </div>
                {loading ? (
                  <Skeleton className="mt-4 h-10 w-20 bg-white/10" />
                ) : (
                  <div className="dashboard-stat-value">{stat.value}</div>
                )}
                <div className="dashboard-stat-bottom">
                  <span className="dashboard-stat-marker" />
                  <span>{stat.note}</span>
                </div>
                <div className="dashboard-stat-glow" aria-hidden="true" />
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="dashboard-section-heading dashboard-analytics-heading">
          <div>
            <div className="dashboard-section-kicker">CLUSTER INTELLIGENCE</div>
            <h2>Understand what is happening</h2>
          </div>
          <div className="dashboard-section-aside">
            <CircleDot className="h-3.5 w-3.5" /> LIVE AGENT + INVENTORY DATA
          </div>
        </section>
        <section className="dashboard-charts-grid">
          <Card className="dashboard-panel">
            <CardHeader className="dashboard-panel-header">
              <div>
                <div className="dashboard-panel-kicker">01 / HEALTH</div>
                <CardTitle>Inventory health distribution</CardTitle>
                <p>Source inventory labels, not live node status</p>
              </div>
              <span className="dashboard-panel-symbol">
                <Activity className="h-4 w-4" />
              </span>
            </CardHeader>
            <CardContent className="dashboard-chart-content">
              {loading ? (
                <Skeleton className="h-[220px] w-full bg-white/5" />
              ) : healthChartData.length === 0 ? (
                <div className="dashboard-chart-empty">
                  No inventory health data
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={healthChartData}
                    margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                  >
                    <XAxis
                      dataKey="name"
                      tick={{ fill: "#9aabba", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: "#718598", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip contentStyle={panelTooltip} />
                    <Bar
                      dataKey="value"
                      name="Clusters"
                      fill="#67d9e8"
                      radius={[5, 5, 0, 0]}
                      maxBarSize={46}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card className="dashboard-panel">
            <CardHeader className="dashboard-panel-header">
              <div>
                <div className="dashboard-panel-kicker">02 / SEVERITY</div>
                <CardTitle>AI finding distribution</CardTitle>
                <p>Explainable rule-engine findings</p>
              </div>
              <span className="dashboard-panel-symbol">
                <ShieldCheck className="h-4 w-4" />
              </span>
            </CardHeader>
            <CardContent className="dashboard-chart-content">
              {loading ? (
                <Skeleton className="h-[220px] w-full bg-white/5" />
              ) : severityChartData.length === 0 ? (
                <div className="dashboard-chart-empty">
                  No findings returned by the analysis API
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={severityChartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="48%"
                      innerRadius={54}
                      outerRadius={82}
                      paddingAngle={3}
                      stroke="none"
                    >
                      {severityChartData.map((entry, index) => (
                        <Cell
                          key={entry.name}
                          fill={PIE_COLORS[index % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={panelTooltip} />
                    <Legend
                      verticalAlign="bottom"
                      iconType="circle"
                      iconSize={7}
                      wrapperStyle={{
                        fontSize: 10,
                        color: "#9aabba",
                        paddingTop: 4,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="dashboard-charts-grid">
          <Card className="dashboard-panel">
            <CardHeader className="dashboard-panel-header">
              <div>
                <div className="dashboard-panel-kicker">03 / LIVE LOAD</div>
                <CardTitle>Agent CPU by local cluster</CardTitle>
                <p>Measured from Kubernetes agent telemetry</p>
              </div>
              <span className="dashboard-panel-symbol">
                <Activity className="h-4 w-4" />
              </span>
            </CardHeader>
            <CardContent className="dashboard-chart-content">
              {cpuChartData.length === 0 ? (
                <div className="dashboard-chart-empty">
                  Waiting for local agent heartbeat
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={cpuChartData}>
                    <XAxis
                      dataKey="cluster"
                      tick={{ fill: "#9aabba", fontSize: 10 }}
                    />
                    <YAxis unit="%" tick={{ fill: "#718598", fontSize: 10 }} />
                    <Tooltip contentStyle={panelTooltip} />
                    <Bar
                      dataKey="cpu"
                      name="CPU"
                      fill="#67d9e8"
                      radius={[5, 5, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card className="dashboard-panel">
            <CardHeader className="dashboard-panel-header">
              <div>
                <div className="dashboard-panel-kicker">04 / AUTOMATION</div>
                <CardTitle>Response activity</CardTitle>
                <p>API command queue and approval status</p>
              </div>
              <span className="dashboard-panel-symbol">
                <Workflow className="h-4 w-4" />
              </span>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-3xl font-semibold text-foreground">
                {commands.data?.items.length ?? "—"}
              </div>
              <p className="text-xs text-muted-foreground">
                Automation commands currently recorded by this API process.
              </p>
              {(commands.data?.items ?? []).slice(0, 4).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 border-t border-border/50 pt-2 text-xs"
                >
                  <span className="truncate text-foreground">
                    {item.action} · {item.clusterId}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {item.status}
                  </span>
                </div>
              ))}
              {!commands.data?.items.length && (
                <div className="dashboard-chart-empty">
                  No commands recorded
                </div>
              )}
              <div className="text-[10px] text-muted-foreground">
                Kubernetes mutations remain approval-gated; current local agents
                are read-only.
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="dashboard-alerts-section">
          <Card className="dashboard-panel dashboard-alerts-panel">
            <CardHeader className="dashboard-panel-header dashboard-alerts-header">
              <div>
                <div className="dashboard-panel-kicker">05 / FINDINGS</div>
                <CardTitle>Signals requiring attention</CardTitle>
                <p>Current analysis output from the Go API</p>
              </div>
              <div className="dashboard-alert-count">
                <span className="dashboard-alert-count-dot" />
                {findings.length} FINDINGS
              </div>
            </CardHeader>
            <CardContent className="dashboard-alerts-content">
              {findings.length === 0 ? (
                <div className="dashboard-alert-empty">
                  <span className="dashboard-empty-icon">
                    <CheckCircle2 className="h-5 w-5" />
                  </span>
                  <div>
                    <p>No current findings</p>
                    <span>Run cluster analysis to refresh the assessment.</span>
                  </div>
                </div>
              ) : (
                <div className="dashboard-alert-list">
                  {findings.slice(0, 6).map((item, index) => (
                    <div key={item.id} className="dashboard-alert-row">
                      <div className="dashboard-alert-leading">
                        <span className="dashboard-alert-index">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <SeverityBadge severity={item.severity} />
                      </div>
                      <div className="dashboard-alert-main">
                        <span className="dashboard-alert-title">
                          {item.title}
                        </span>
                        <span className="dashboard-alert-source">
                          {item.clusterName} · {item.category}
                        </span>
                      </div>
                      <ArrowUpRight className="dashboard-alert-arrow h-4 w-4" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
        <footer className="dashboard-footer">
          <span>CLOUDSENTINELS / CLUSTER OBSERVABILITY</span>
          <span>
            {warningEvents} LIVE WARNING EVENTS ·{" "}
            {platform.data?.executionMode ?? "MODE CHECKING"}
          </span>
        </footer>
      </div>
    </div>
  );
}
