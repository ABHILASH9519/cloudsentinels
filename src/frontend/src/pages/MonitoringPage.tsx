import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, CheckCheck, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import {
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
import { StatusBadge } from "../components/StatusBadge";
import { useClusterMonitoring } from "../hooks/useClusterData";
import {
  useAddAlert,
  useAddMetric,
  useGetActiveAlerts,
  useGetAutomationEvents,
  useGetRecentMetrics,
  useUpdateAlertStatus,
} from "../hooks/useQueries";

const LINE_COLORS = ["#22d3ee", "#10b981", "#f59e0b", "#ef4444", "#a855f7"];

export function MonitoringPage() {
  const clusterMonitoring = useClusterMonitoring();
  const clusterSummary = clusterMonitoring.data;
  const { data: alerts, isLoading: alertsLoading } = useGetActiveAlerts();
  const { data: metrics, isLoading: metricsLoading } = useGetRecentMetrics(50n);
  const {
    data: automationEvents,
    isLoading: automationLoading,
    isError: automationError,
  } = useGetAutomationEvents();
  const addAlert = useAddAlert();
  const addMetric = useAddMetric();
  const updateAlertStatus = useUpdateAlertStatus();

  const [alertOpen, setAlertOpen] = useState(false);
  const [metricOpen, setMetricOpen] = useState(false);
  const [alertForm, setAlertForm] = useState({
    title: "",
    severity: "medium",
    source: "",
    message: "",
  });
  const [metricForm, setMetricForm] = useState({
    name: "",
    value: "",
    unit: "",
    source: "",
  });

  // Group metrics by name for chart
  const metricNames = [...new Set((metrics ?? []).map((m) => m.name))];
  const chartData = (metrics ?? []).reduce<
    Record<string, Record<string, number | string>>
  >((acc, m) => {
    const ts = new Date(Number(m.timestamp) / 1_000_000).toLocaleTimeString();
    if (!acc[ts]) acc[ts] = { time: ts };
    acc[ts][m.name] = m.value;
    return acc;
  }, {});
  const chartRows = Object.values(chartData).slice(-20);

  const handleAddAlert = async () => {
    if (!alertForm.title.trim()) {
      toast.error("Title required");
      return;
    }
    try {
      await addAlert.mutateAsync(alertForm);
      toast.success("Alert added");
      setAlertOpen(false);
      setAlertForm({ title: "", severity: "medium", source: "", message: "" });
    } catch {
      toast.error("Failed to add alert");
    }
  };

  const handleAddMetric = async () => {
    const value = Number(metricForm.value);
    if (!metricForm.name.trim() || metricForm.value.trim() === "") {
      toast.error("Metric name and value are required");
      return;
    }
    if (!Number.isFinite(value)) {
      toast.error("Enter a valid finite metric value");
      return;
    }
    try {
      await addMetric.mutateAsync({
        ...metricForm,
        name: metricForm.name.trim(),
        value,
      });
      toast.success("Metric added");
      setMetricOpen(false);
      setMetricForm({ name: "", value: "", unit: "", source: "" });
    } catch {
      toast.error("Failed to add metric");
    }
  };

  const handleAck = async (id: bigint) => {
    try {
      await updateAlertStatus.mutateAsync({ id, status: "acknowledged" });
      toast.success("Alert acknowledged");
    } catch {
      toast.error("Failed");
    }
  };

  const handleResolve = async (id: bigint) => {
    try {
      await updateAlertStatus.mutateAsync({ id, status: "resolved" });
      toast.success("Alert resolved");
    } catch {
      toast.error("Failed");
    }
  };

  return (
    <div className="mission-page p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-700 text-foreground">
            Monitoring
          </h1>
          <p className="text-sm text-muted-foreground">
            Live alerts and system metrics
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Dialog open={alertOpen} onOpenChange={setAlertOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                data-ocid="monitoring.add_alert.button"
                className="gap-2"
              >
                <Bell className="w-4 h-4" />
                Add Alert
              </Button>
            </DialogTrigger>
            <DialogContent
              className="bg-card border-border"
              data-ocid="monitoring.alert.dialog"
            >
              <DialogHeader>
                <DialogTitle className="font-display">Add Alert</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div>
                  <Label>Title</Label>
                  <Input
                    data-ocid="monitoring.alert_title.input"
                    value={alertForm.title}
                    onChange={(e) =>
                      setAlertForm((p) => ({ ...p, title: e.target.value }))
                    }
                    placeholder="Alert title"
                  />
                </div>
                <div>
                  <Label>Severity</Label>
                  <Select
                    value={alertForm.severity}
                    onValueChange={(v) =>
                      setAlertForm((p) => ({ ...p, severity: v }))
                    }
                  >
                    <SelectTrigger data-ocid="monitoring.alert_severity.select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="critical">Critical</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Source</Label>
                  <Input
                    data-ocid="monitoring.alert_source.input"
                    value={alertForm.source}
                    onChange={(e) =>
                      setAlertForm((p) => ({ ...p, source: e.target.value }))
                    }
                    placeholder="prometheus, elk..."
                  />
                </div>
                <div>
                  <Label>Message</Label>
                  <Input
                    data-ocid="monitoring.alert_message.input"
                    value={alertForm.message}
                    onChange={(e) =>
                      setAlertForm((p) => ({ ...p, message: e.target.value }))
                    }
                    placeholder="Alert message"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setAlertOpen(false)}
                  data-ocid="monitoring.alert.cancel_button"
                >
                  Cancel
                </Button>
                <Button
                  data-ocid="monitoring.alert.submit_button"
                  onClick={handleAddAlert}
                  disabled={addAlert.isPending}
                  className="bg-primary/90 hover:bg-primary text-primary-foreground"
                >
                  {addAlert.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : null}
                  Add
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={metricOpen} onOpenChange={setMetricOpen}>
            <DialogTrigger asChild>
              <Button
                data-ocid="monitoring.add_metric.button"
                className="gap-2 bg-primary/90 hover:bg-primary text-primary-foreground"
              >
                <Plus className="w-4 h-4" />
                Add Metric
              </Button>
            </DialogTrigger>
            <DialogContent
              className="bg-card border-border"
              data-ocid="monitoring.metric.dialog"
            >
              <DialogHeader>
                <DialogTitle className="font-display">Add Metric</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div>
                  <Label>Metric Name</Label>
                  <Input
                    data-ocid="monitoring.metric_name.input"
                    value={metricForm.name}
                    onChange={(e) =>
                      setMetricForm((p) => ({ ...p, name: e.target.value }))
                    }
                    placeholder="cpu_usage, memory_usage..."
                  />
                </div>
                <div>
                  <Label>Value</Label>
                  <Input
                    data-ocid="monitoring.metric_value.input"
                    type="number"
                    value={metricForm.value}
                    onChange={(e) =>
                      setMetricForm((p) => ({ ...p, value: e.target.value }))
                    }
                    placeholder="e.g. 85.5"
                  />
                </div>
                <div>
                  <Label>Unit</Label>
                  <Input
                    data-ocid="monitoring.metric_unit.input"
                    value={metricForm.unit}
                    onChange={(e) =>
                      setMetricForm((p) => ({ ...p, unit: e.target.value }))
                    }
                    placeholder="%, MB, req/s..."
                  />
                </div>
                <div>
                  <Label>Source</Label>
                  <Input
                    data-ocid="monitoring.metric_source.input"
                    value={metricForm.source}
                    onChange={(e) =>
                      setMetricForm((p) => ({ ...p, source: e.target.value }))
                    }
                    placeholder="node-1, pod-name..."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setMetricOpen(false)}
                  data-ocid="monitoring.metric.cancel_button"
                >
                  Cancel
                </Button>
                <Button
                  data-ocid="monitoring.metric.submit_button"
                  onClick={handleAddMetric}
                  disabled={addMetric.isPending}
                  className="bg-primary/90 hover:bg-primary text-primary-foreground"
                >
                  {addMetric.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : null}
                  Add
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="font-display text-base font-semibold text-foreground">Kubernetes cluster telemetry</h2>
          <p className="text-xs text-muted-foreground">Live agent readings are shown separately from Airtable inventory-reported values.</p>
        </div>
        {clusterMonitoring.isError && (
          <Card className="border-rose-300/20"><CardContent className="p-4 text-sm text-rose-200">
            {clusterMonitoring.error instanceof Error ? clusterMonitoring.error.message : "Cluster telemetry API unavailable."}
          </CardContent></Card>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="mission-panel"><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Airtable cluster records</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{clusterSummary?.dataQuality.clusterRecordCount ?? "—"}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">Source inventory</div>
          </CardContent></Card>
          <Card className="mission-panel"><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Connected Kubernetes agents</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{clusterSummary?.localAgent.length ?? "—"}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">Fresh agent heartbeats</div>
          </CardContent></Card>
          <Card className="mission-panel"><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Live local nodes / pods</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {clusterSummary ? `${clusterSummary.localAgent.reduce((n, a) => n + a.readyNodeCount, 0)} / ${clusterSummary.localAgent.reduce((n, a) => n + a.podCount, 0)}` : "—"}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">Collected from Kubernetes API</div>
          </CardContent></Card>
        </div>
        {clusterSummary?.localAgent.map((agent) => (
          <Card key={agent.clusterId} className="mission-panel">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="text-sm font-medium text-foreground">{agent.context}</div>
                <div className="font-mono text-[10px] text-muted-foreground">{agent.collector} · {agent.clusterId}</div>
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>{agent.readyNodeCount}/{agent.nodeCount} nodes ready</span>
                <span>{agent.podCount} pods</span>
                <span>{agent.warningEvents} warning events</span>
                <span>Seen {new Date(agent.collectedAt).toLocaleTimeString()}</span>
              </div>
            </CardContent>
          </Card>
        ))}
        {clusterSummary?.dataQuality.notes.map((note) => (
          <p key={note} className="text-[10px] leading-relaxed text-muted-foreground">{note}</p>
        ))}
      </section>

      {/* Active Alerts */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-400 pulse-dot" />
            Active Alerts ({alerts?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {alertsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : !alerts || alerts.length === 0 ? (
            <div
              className="text-center py-10 text-muted-foreground text-sm"
              data-ocid="monitoring.alerts.empty_state"
            >
              No active alerts — systems nominal
            </div>
          ) : (
            <div className="space-y-2" data-ocid="monitoring.alerts.list">
              {alerts.map((alert, i) => (
                <div
                  key={alert.id.toString()}
                  data-ocid={`monitoring.alerts.item.${i + 1}`}
                  className="flex items-center justify-between p-3 rounded-md bg-muted/30 border border-border"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <SeverityBadge severity={alert.severity} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">
                        {alert.title}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {alert.message}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <StatusBadge status={alert.status} />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAck(alert.id)}
                      className="text-xs h-7"
                    >
                      Ack
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleResolve(alert.id)}
                      className="text-xs h-7 text-green-400 border-green-500/30 hover:bg-green-500/10"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Metrics Chart */}
      <Card className="telemetry-glass border-cyan-200/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Recent Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          {metricsLoading ? (
            <Skeleton className="h-56" />
          ) : chartRows.length === 0 ? (
            <div
              className="h-56 flex items-center justify-center text-muted-foreground text-sm"
              data-ocid="monitoring.metrics.empty_state"
            >
              No metrics yet — add one above
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart
                data={chartRows}
                margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
              >
                <XAxis
                  dataKey="time"
                  tick={{ fill: "#6b7280", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "#6b7280", fontSize: 10 }}
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
                <Legend wrapperStyle={{ fontSize: 11, color: "#6b7280" }} />
                {metricNames.map((name, i) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={LINE_COLORS[i % LINE_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Automation activity */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-3 text-sm font-medium text-muted-foreground">
            <span>Automation activity</span>
            <span className="font-mono text-[10px] text-cyan-300">
              {automationEvents?.length ?? 0} RECENT EVENTS
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {automationLoading ? (
            <div className="space-y-2" data-ocid="monitoring.automation.loading_state">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : automationError ? (
            <div className="py-8 text-center text-sm text-rose-300" role="alert">
              Automation activity could not be loaded. Check the API connection and retry after the runtime is updated.
            </div>
          ) : !automationEvents || automationEvents.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground" data-ocid="monitoring.automation.empty_state">
              No automation events yet. New incidents and alerts will appear here after the automation processor is running.
            </div>
          ) : (
            <div className="space-y-2" data-ocid="monitoring.automation.list">
              {automationEvents.map((event, index) => (
                <div
                  key={event.id}
                  data-ocid={`monitoring.automation.item.${index + 1}`}
                  className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-foreground">{event.eventType}</span>
                      <StatusBadge status={event.status} />
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                        {event.risk} risk
                      </span>
                      {event.requiresApproval && (
                        <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300">
                          Approval required
                        </span>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{event.reason}</p>
                    {event.clusterName && (
                      <p className="text-[10px] font-mono text-muted-foreground">
                        cluster · {event.clusterName}
                      </p>
                    )}
                    {event.recommendedAction && (
                      <p className="text-[11px] text-cyan-200">
                        Recommended: {event.recommendedAction}
                        {event.clusterName ? ` · ${event.clusterName}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{event.recoveryVerified ? "Recovery verified" : "Not yet verified"}</span>
                    <span>·</span>
                    <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
