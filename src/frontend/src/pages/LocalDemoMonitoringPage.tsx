import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, AlertTriangle, CheckCircle2, Database, Server } from "lucide-react";
import { useClusterInventory, useClusterMonitoring } from "../hooks/useClusterData";

function Status({ value }: { value: string }) {
  const tone = value.toLowerCase() === "healthy" || value.toLowerCase() === "active"
    ? "border-emerald-300/20 bg-emerald-300/5 text-emerald-200"
    : value.toLowerCase() === "critical" || value.toLowerCase() === "offline"
      ? "border-rose-300/20 bg-rose-300/5 text-rose-200"
      : "border-amber-300/20 bg-amber-300/5 text-amber-200";
  return <span className={`inline-flex rounded-full border px-2 py-1 font-mono text-[10px] uppercase ${tone}`}>{value}</span>;
}

export function LocalDemoMonitoringPage() {
  const monitoring = useClusterMonitoring();
  const inventory = useClusterInventory();
  const summary = monitoring.data;
  const clusters = summary?.clusters ?? [];
  const stats = [
    { label: "Inventory clusters", value: inventory.data?.count ?? "—", note: "Sanitized Airtable snapshot", icon: Database },
    { label: "Healthy records", value: summary?.counts.healthy ?? "—", note: "Reported health state", icon: CheckCircle2 },
    { label: "Warnings", value: summary?.counts.warning ?? "—", note: "Reported warning state", icon: AlertTriangle },
    { label: "Average reported CPU", value: summary ? `${summary.averageReportedCPUPercent.toFixed(1)}%` : "—", note: "Inventory / agent values", icon: Activity },
  ];
  return (
    <div className="mission-page space-y-6 p-6">
      <div>
        <div className="mb-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.2em] text-cyan-200/70"><Activity className="h-3.5 w-3.5" /> Operational telemetry</div>
        <h1 className="font-display text-2xl font-bold text-foreground">Monitoring</h1>
        <p className="mt-1 text-sm text-muted-foreground">Cluster inventory, reported resource readings and agent freshness from the Go monitoring API.</p>
      </div>
      {monitoring.isError && <Card className="border-rose-300/20"><CardContent className="p-4 text-sm text-rose-200">{monitoring.error instanceof Error ? monitoring.error.message : "Monitoring API unavailable."}</CardContent></Card>}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => <Card key={stat.label} className="mission-panel"><CardContent className="p-4"><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{stat.label}</span><stat.icon className="h-4 w-4 text-cyan-200" /></div><div className="mt-3 text-2xl font-semibold text-foreground">{stat.value}</div><div className="mt-1 text-[10px] text-muted-foreground">{stat.note}</div></CardContent></Card>)}
      </section>
      <Card className="border-amber-300/20 bg-amber-300/[.035]">
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-100"><Server className="h-4 w-4" /> Telemetry source and freshness</div>
          <p className="text-xs leading-relaxed text-muted-foreground">Current mode: {summary?.inventorySource ?? "loading"}. The local Kubernetes agent is {summary?.localAgent?.length ? "reporting telemetry" : "not connected"}. Airtable CPU and memory fields are inventory-reported values, not a live metrics stream. Live agent telemetry appears here only after a real agent heartbeat.</p>
          <div className="text-xs text-muted-foreground">Last API summary: {summary?.generatedAt ? new Date(summary.generatedAt).toLocaleString() : "Waiting for first response"}</div>
        </CardContent>
      </Card>
      <Card className="mission-panel overflow-hidden">
        <CardHeader><CardTitle className="text-sm">Cluster resource inventory</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead className="border-y border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="p-3">Cluster</th><th className="p-3">Health</th><th className="p-3">Nodes ready</th><th className="p-3">Pods</th><th className="p-3">CPU</th><th className="p-3">Memory</th><th className="p-3">Source</th></tr></thead>
            <tbody>{clusters.map((cluster) => <tr key={cluster.id} className="border-b border-border/40 last:border-0"><td className="p-3"><div className="font-medium text-foreground">{cluster.name}</div><div className="font-mono text-[9px] text-muted-foreground">{cluster.environment}</div></td><td className="p-3"><Status value={cluster.healthStatus} /></td><td className="p-3 tabular-nums text-foreground">{cluster.readyNodeCount ?? "—"} / {cluster.nodeCount}</td><td className="p-3 tabular-nums text-foreground">{cluster.podCount}</td><td className="p-3 tabular-nums text-foreground">{cluster.cpuUsagePercent}%</td><td className="p-3 tabular-nums text-foreground">{cluster.memoryUsageMB.toLocaleString()} MB</td><td className="p-3 font-mono text-[9px] text-muted-foreground">{cluster.source}</td></tr>)}</tbody>
          </table>
          {!monitoring.isLoading && clusters.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">No cluster monitoring records are available.</div>}
        </CardContent>
      </Card>
    </div>
  );
}
