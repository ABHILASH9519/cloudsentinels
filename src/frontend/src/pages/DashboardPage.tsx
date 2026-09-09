import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
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

const PIE_COLORS = ["#22d3ee", "#f59e0b", "#10b981", "#ef4444", "#a855f7"];

export function DashboardPage() {
  const { data: summary, isLoading: summaryLoading } = useDashboardSummary();
  const { data: activeAlerts, isLoading: alertsLoading } = useGetActiveAlerts();

  const totalIncidents =
    summary?.incidentsByStatus?.reduce((a, [, v]) => a + Number(v), 0) ?? 0;
  const openCount = Number(
    summary?.incidentsByStatus?.find(([k]) => k === "open")?.[1] ?? 0,
  );
  const criticalCount = Number(
    summary?.incidentsBySeverity?.find(([k]) => k === "critical")?.[1] ?? 0,
  );
  const activeAlertsCount = Number(summary?.activeAlertsCount ?? 0);

  const statusChartData =
    summary?.incidentsByStatus?.map(([name, value]) => ({
      name,
      value: Number(value),
    })) ?? [];
  const severityChartData =
    summary?.incidentsBySeverity?.map(([name, value]) => ({
      name,
      value: Number(value),
    })) ?? [];

  const stats = [
    {
      label: "Total Incidents",
      value: totalIncidents,
      icon: AlertTriangle,
      color: "text-blue-400",
    },
    {
      label: "Open",
      value: openCount,
      icon: TrendingUp,
      color: "text-amber-400",
    },
    {
      label: "Active Alerts",
      value: activeAlertsCount,
      icon: Activity,
      color: "text-red-400",
    },
    {
      label: "Critical",
      value: criticalCount,
      icon: CheckCircle2,
      color: "text-orange-400",
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="font-display text-2xl font-700 text-foreground">
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Real-time infrastructure overview
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">
                  {stat.label}
                </span>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
              {summaryLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className={`text-3xl font-display font-700 ${stat.color}`}>
                  {stat.value}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Incidents by Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-48" />
            ) : statusChartData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                No data yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={statusChartData}
                  margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                >
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "#6b7280", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#6b7280", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "oklch(0.16 0.018 240)",
                      border: "1px solid oklch(0.22 0.02 240)",
                      borderRadius: 6,
                      color: "#e5e7eb",
                    }}
                  />
                  <Bar
                    dataKey="value"
                    fill="oklch(0.72 0.18 195)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Incidents by Severity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-48" />
            ) : severityChartData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                No data yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={severityChartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    label={({ name, percent }) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {severityChartData.map((entry, i) => (
                      <Cell
                        key={entry.name}
                        fill={PIE_COLORS[i % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "oklch(0.16 0.018 240)",
                      border: "1px solid oklch(0.22 0.02 240)",
                      borderRadius: 6,
                      color: "#e5e7eb",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: "#6b7280" }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active Alerts */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-400 pulse-dot" />
            Active Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {alertsLoading ? (
            <div className="space-y-2">
              {["a", "b", "c"].map((k) => (
                <Skeleton key={k} className="h-10" />
              ))}
            </div>
          ) : !activeAlerts || activeAlerts.length === 0 ? (
            <div
              className="text-center py-8 text-muted-foreground text-sm"
              data-ocid="monitoring.alerts.empty_state"
            >
              No active alerts — all systems nominal
            </div>
          ) : (
            <div className="space-y-2">
              {activeAlerts.slice(0, 5).map((alert, i) => (
                <div
                  key={alert.id.toString()}
                  data-ocid={`alerts.item.${i + 1}`}
                  className="flex items-center justify-between p-3 rounded-md bg-muted/30 border border-border"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <SeverityBadge severity={alert.severity} />
                    <span className="text-sm text-foreground truncate">
                      {alert.title}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground font-mono shrink-0 ml-2">
                    {alert.source}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Loading state */}
      {(summaryLoading || alertsLoading) && (
        <div data-ocid="dashboard.loading_state" className="hidden" />
      )}
    </div>
  );
}
