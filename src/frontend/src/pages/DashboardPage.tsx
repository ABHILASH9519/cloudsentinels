import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  Radio,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
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
import { useDashboardSummary, useGetActiveAlerts } from "../hooks/useQueries";

const PIE_COLORS = ["#67e8f9", "#fbbf24", "#4ade80", "#fb7185", "#a78bfa"];

function formatUpdatedAt(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function DashboardPage() {
  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
    error: summaryFailure,
    refetch: refetchSummary,
    dataUpdatedAt,
  } = useDashboardSummary();
  const {
    data: activeAlerts,
    isLoading: alertsLoading,
    isError: alertsError,
    error: alertsFailure,
    refetch: refetchAlerts,
  } = useGetActiveAlerts();

  const totalIncidents =
    summary?.incidentsByStatus?.reduce((total, [, value]) => total + Number(value), 0) ?? 0;
  const openCount = Number(
    summary?.incidentsByStatus?.find(([key]) => key === "open")?.[1] ?? 0,
  );
  const criticalCount = Number(
    summary?.incidentsBySeverity?.find(([key]) => key === "critical")?.[1] ?? 0,
  );
  const activeAlertsCount = Number(summary?.activeAlertsCount ?? 0);

  const statusChartData =
    summary?.incidentsByStatus?.map(([name, value]) => ({
      name: name.replace(/_/g, " "),
      value: Number(value),
    })) ?? [];
  const severityChartData =
    summary?.incidentsBySeverity?.map(([name, value]) => ({
      name: name.replace(/_/g, " "),
      value: Number(value),
    })) ?? [];

  const apiState = summaryLoading
    ? "Synchronizing"
    : summaryError
      ? "Connection issue"
      : "Telemetry received";
  const apiStateClass = summaryError
    ? "dashboard-state dashboard-state-error"
    : summaryLoading
      ? "dashboard-state dashboard-state-loading"
      : "dashboard-state dashboard-state-live";

  const stats = [
    {
      label: "Total incidents",
      value: totalIncidents,
      note: "Across all recorded states",
      icon: AlertTriangle,
      tone: "cyan",
      accent: "var(--dash-cyan)",
    },
    {
      label: "Open incidents",
      value: openCount,
      note: "Require investigation",
      icon: TrendingUp,
      tone: "amber",
      accent: "var(--dash-amber)",
    },
    {
      label: "Active alerts",
      value: activeAlertsCount,
      note: "Currently reported by API",
      icon: Activity,
      tone: "rose",
      accent: "var(--dash-rose)",
    },
    {
      label: "Critical incidents",
      value: criticalCount,
      note: "Highest severity",
      icon: ShieldCheck,
      tone: "violet",
      accent: "var(--dash-violet)",
    },
  ];

  return (
    <div className="mission-page dashboard-page">
      <div className="dashboard-shell">
        <section className="dashboard-heading">
          <div>
            <div className="dashboard-eyebrow"><span /> CLOUD OPERATIONS / OVERVIEW</div>
            <h1>Mission control<span>.</span></h1>
            <p>One view of your infrastructure signals, incidents, and response activity.</p>
          </div>
          <div className={apiStateClass} role="status" aria-live="polite">
            <span className="dashboard-state-dot" />
            <span>{apiState}</span>
            <span className="dashboard-state-divider" />
            <span className="dashboard-state-meta">AWS CONTROL PLANE</span>
          </div>
        </section>

        <section className="dashboard-orbit-panel">
          <div className="dashboard-orbit-copy">
            <div className="dashboard-orbit-kicker"><Radio className="h-3.5 w-3.5" /> AUTONOMOUS DEFENSE SYSTEM</div>
            <h2>See the signal.<br /><em>Stay ahead of the incident.</em></h2>
            <p>CloudSentinels brings monitoring, incident intelligence, and self-healing workflows into one operational view.</p>
            <div className="dashboard-orbit-meta">
              <span><span className="dashboard-mini-dot" /> OBSERVE</span>
              <span><span className="dashboard-mini-dot" /> ANALYZE</span>
              <span><span className="dashboard-mini-dot" /> RESPOND</span>
            </div>
          </div>
          <div className="dashboard-orbit-art" aria-hidden="true">
            <div className="dashboard-orbit-ring dashboard-orbit-ring-outer" />
            <div className="dashboard-orbit-ring dashboard-orbit-ring-middle" />
            <div className="dashboard-orbit-ring dashboard-orbit-ring-inner" />
            <div className="dashboard-planet">
              <span className="dashboard-planet-glow" />
            </div>
            <div className="dashboard-orbit-satellite"><span /></div>
            <div className="dashboard-orbit-crosshair dashboard-orbit-crosshair-one" />
            <div className="dashboard-orbit-crosshair dashboard-orbit-crosshair-two" />
          </div>
          <div className="dashboard-orbit-footer">
            <span>CS / SYSTEM TELEMETRY</span>
            <span>REGION · AP-SOUTH-1</span>
            <span>MODE · CONTINUOUS OBSERVATION</span>
          </div>
        </section>

        <section className="dashboard-section-heading">
          <div>
            <div className="dashboard-section-kicker">SYSTEM SNAPSHOT</div>
            <h2>Infrastructure at a glance</h2>
          </div>
          <div className="dashboard-updated">
            <Clock3 className="h-3.5 w-3.5" />
            {dataUpdatedAt ? `Updated ${formatUpdatedAt(new Date(dataUpdatedAt))}` : "Waiting for first sync"}
          </div>
        </section>

        {summaryError && (
          <div role="alert" className="dashboard-error">
            <div>
              <p className="font-semibold">Unable to retrieve dashboard telemetry</p>
              <p>{summaryFailure instanceof Error ? summaryFailure.message : "The API request failed. Check the connection and try again."}</p>
            </div>
            <button type="button" onClick={() => void refetchSummary()}><RefreshCw className="h-4 w-4" /> Retry sync</button>
          </div>
        )}

        <section className="dashboard-stats-grid" aria-label="Incident metrics">
          {stats.map((stat, index) => (
            <Card key={stat.label} className={`dashboard-stat-card dashboard-stat-${stat.tone}`} style={{ animationDelay: `${index * 70}ms` }}>
              <CardContent className="dashboard-stat-content">
                <div className="dashboard-stat-topline">
                  <span>{stat.label}</span>
                  <span className="dashboard-stat-icon"><stat.icon className="h-[17px] w-[17px]" /></span>
                </div>
                {summaryLoading ? (
                  <Skeleton className="mt-4 h-10 w-20 bg-white/10" />
                ) : summaryError ? (
                  <div className="dashboard-stat-unavailable">Unavailable</div>
                ) : (
                  <div className="dashboard-stat-value">{stat.value.toLocaleString()}</div>
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
            <div className="dashboard-section-kicker">INCIDENT INTELLIGENCE</div>
            <h2>Understand what is happening</h2>
          </div>
          <div className="dashboard-section-aside"><CircleDot className="h-3.5 w-3.5" /> DATA FROM CONNECTED API</div>
        </section>

        <section className="dashboard-charts-grid">
          <Card className="dashboard-panel">
            <CardHeader className="dashboard-panel-header">
              <div>
                <div className="dashboard-panel-kicker">01 / DISTRIBUTION</div>
                <CardTitle>Incidents by status</CardTitle>
                <p>How reported incidents are progressing</p>
              </div>
              <span className="dashboard-panel-symbol"><Activity className="h-4 w-4" /></span>
            </CardHeader>
            <CardContent className="dashboard-chart-content">
              {summaryLoading ? (
                <Skeleton className="h-[220px] w-full bg-white/5" />
              ) : summaryError ? (
                <div className="dashboard-chart-empty text-rose-300">Status data unavailable</div>
              ) : statusChartData.length === 0 ? (
                <div className="dashboard-chart-empty">No incidents recorded yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={statusChartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fill: "#9aabba", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fill: "#718598", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: "rgba(103,232,249,.06)" }} contentStyle={{ background: "#0b1727", border: "1px solid rgba(148,190,213,.2)", borderRadius: 10, color: "#e8f5fc", fontSize: 12 }} />
                    <Bar dataKey="value" name="Incidents" fill="#67d9e8" radius={[5, 5, 0, 0]} maxBarSize={46} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="dashboard-panel">
            <CardHeader className="dashboard-panel-header">
              <div>
                <div className="dashboard-panel-kicker">02 / SEVERITY</div>
                <CardTitle>Threat distribution</CardTitle>
                <p>Incidents grouped by severity level</p>
              </div>
              <span className="dashboard-panel-symbol"><ShieldCheck className="h-4 w-4" /></span>
            </CardHeader>
            <CardContent className="dashboard-chart-content">
              {summaryLoading ? (
                <Skeleton className="h-[220px] w-full bg-white/5" />
              ) : summaryError ? (
                <div className="dashboard-chart-empty text-rose-300">Severity data unavailable</div>
              ) : severityChartData.length === 0 ? (
                <div className="dashboard-chart-empty">No severity data available</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={severityChartData} dataKey="value" nameKey="name" cx="50%" cy="48%" innerRadius={54} outerRadius={82} paddingAngle={3} stroke="none">
                      {severityChartData.map((entry, index) => (
                        <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#0b1727", border: "1px solid rgba(148,190,213,.2)", borderRadius: 10, color: "#e8f5fc", fontSize: 12 }} />
                    <Legend verticalAlign="bottom" iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 10, color: "#9aabba", paddingTop: 4 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="dashboard-alerts-section">
          <Card className="dashboard-panel dashboard-alerts-panel">
            <CardHeader className="dashboard-panel-header dashboard-alerts-header">
              <div>
                <div className="dashboard-panel-kicker">03 / LIVE FEED</div>
                <CardTitle>Active alerts</CardTitle>
                <p>Signals requiring attention from connected services</p>
              </div>
              <div className="dashboard-alert-count">
                <span className={alertsError ? "dashboard-alert-count-dot is-error" : "dashboard-alert-count-dot"} />
                {alertsLoading ? "SYNCING" : alertsError ? "UNAVAILABLE" : `${activeAlerts?.length ?? 0} REPORTED`}
              </div>
            </CardHeader>
            <CardContent className="dashboard-alerts-content">
              {alertsLoading ? (
                <div className="space-y-2">{["a", "b", "c"].map((key) => <Skeleton key={key} className="h-14 bg-white/5" />)}</div>
              ) : alertsError ? (
                <div role="alert" className="dashboard-alert-empty dashboard-alert-error">
                  <div><p>Alerts could not be loaded</p><span>{alertsFailure instanceof Error ? alertsFailure.message : "The alerts API request failed."}</span></div>
                  <button type="button" onClick={() => void refetchAlerts()}><RefreshCw className="h-4 w-4" /> Retry alerts</button>
                </div>
              ) : !activeAlerts || activeAlerts.length === 0 ? (
                <div className="dashboard-alert-empty">
                  <span className="dashboard-empty-icon"><CheckCircle2 className="h-5 w-5" /></span>
                  <div><p>No active alerts</p><span>No alert records were returned by the API.</span></div>
                  <span className="dashboard-all-clear">ALL CLEAR</span>
                </div>
              ) : (
                <div className="dashboard-alert-list">
                  {activeAlerts.slice(0, 6).map((alert, index) => (
                    <div key={alert.id.toString()} data-ocid={`alerts.item.${index + 1}`} className="dashboard-alert-row">
                      <div className="dashboard-alert-leading"><span className="dashboard-alert-index">{String(index + 1).padStart(2, "0")}</span><SeverityBadge severity={alert.severity} /></div>
                      <div className="dashboard-alert-main"><span className="dashboard-alert-title">{alert.title}</span><span className="dashboard-alert-source">{alert.source}</span></div>
                      <ArrowUpRight className="dashboard-alert-arrow h-4 w-4" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <footer className="dashboard-footer">
          <span>CLOUDSENTINELS / AUTONOMOUS INFRASTRUCTURE DEFENSE</span>
          <span>TELEMETRY IS SUBJECT TO API AVAILABILITY</span>
        </footer>
      </div>
    </div>
  );
}
