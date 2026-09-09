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
import {
  useAddAlert,
  useAddMetric,
  useGetActiveAlerts,
  useGetRecentMetrics,
  useUpdateAlertStatus,
} from "../hooks/useQueries";

const LINE_COLORS = ["#22d3ee", "#10b981", "#f59e0b", "#ef4444", "#a855f7"];

export function MonitoringPage() {
  const { data: alerts, isLoading: alertsLoading } = useGetActiveAlerts();
  const { data: metrics, isLoading: metricsLoading } = useGetRecentMetrics(50n);
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
    if (!metricForm.name.trim() || !metricForm.value) {
      toast.error("Name and value required");
      return;
    }
    try {
      await addMetric.mutateAsync({
        ...metricForm,
        value: Number.parseFloat(metricForm.value),
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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-700 text-foreground">
            Monitoring
          </h1>
          <p className="text-sm text-muted-foreground">
            Live alerts and system metrics
          </p>
        </div>
        <div className="flex gap-2">
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
      <Card className="bg-card border-border">
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
    </div>
  );
}
