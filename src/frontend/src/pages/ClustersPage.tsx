import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@tanstack/react-router";
import { Activity, AlertTriangle, BrainCircuit, CheckCircle2, Cloud, Database, RefreshCw, Server, Terminal, Workflow } from "lucide-react";
import { toast } from "sonner";
import { useAutomationCommands, useClusterInventory, useClusterMonitoring, useRefreshAirtableInventory, useTestZapierWebhook, useTriggerClusterAnalysis } from "../hooks/useClusterData";

function tone(value: string) {
  const status = value.toLowerCase();
  if (status === "healthy" || status === "active" || status === "succeeded") return "text-emerald-300 border-emerald-300/20 bg-emerald-300/5";
  if (status === "critical" || status === "offline" || status === "failed") return "text-rose-300 border-rose-300/20 bg-rose-300/5";
  if (status === "warning" || status === "degraded" || status === "provisioning" || status === "dispatched") return "text-amber-300 border-amber-300/20 bg-amber-300/5";
  return "text-slate-300 border-slate-300/20 bg-slate-300/5";
}

function StatusPill({ value }: { value: string }) {
  return <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-mono uppercase tracking-wide ${tone(value)}`}>{value}</span>;
}

export function ClustersPage() {
  const inventory = useClusterInventory();
  const monitoring = useClusterMonitoring();
  const commands = useAutomationCommands();
  const refresh = useRefreshAirtableInventory();
  const zapier = useTestZapierWebhook();
  const analyze = useTriggerClusterAnalysis();
  const clusters = inventory.data?.clusters ?? [];
  const summary = monitoring.data;
  const localOnline = (summary?.localAgent ?? []).some((agent) => Date.now() - new Date(agent.collectedAt).getTime() < 120000);

  const refreshInventory = async () => {
    try {
      await refresh.mutateAsync();
      toast.success("Airtable inventory refreshed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Airtable refresh failed");
    }
  };
  const runAnalysis = async () => {
    try {
      const report = await analyze.mutateAsync();
      toast.success(`Analysis completed: ${report.insights.length} cluster findings; high/critical findings were sent to Zapier when configured.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cluster analysis failed");
    }
  };

  const testZapier = async () => {
    try {
      await zapier.mutateAsync();
      toast.success("Zapier Catch Hook received the test event");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Zapier is not configured");
    }
  };

  return (
    <div className="mission-page space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.2em] text-cyan-200/70"><Activity className="h-3.5 w-3.5" /> Cluster observability / inventory fabric</div>
          <h1 className="font-display text-2xl font-bold text-foreground">Cluster Command</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Airtable inventory, desktop Kubernetes telemetry, shared incident triage and approval-gated automation across all three execution modes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={runAnalysis} disabled={analyze.isPending}>
            <BrainCircuit className="mr-2 h-4 w-4" /> {analyze.isPending ? "Analyzing…" : "Run AI analysis"}
          </Button>
          <Button variant="outline" onClick={refreshInventory} disabled={refresh.isPending || !inventory.data?.liveSyncEnabled}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refresh.isPending ? "animate-spin" : ""}`} /> Refresh Airtable
          </Button>
          <Button onClick={testZapier} disabled={zapier.isPending}>
            <Workflow className="mr-2 h-4 w-4" /> Test Zapier
          </Button>
        </div>
      </div>

      {inventory.isError && (
        <Card className="border-rose-300/20 bg-rose-300/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-rose-300" />
            <div><p className="text-sm font-semibold text-rose-200">Go API connection unavailable</p><p className="mt-1 text-xs text-rose-100/70">{inventory.error instanceof Error ? inventory.error.message : "Set VITE_CLOUDSENTINELS_API_URL and ensure the Go API is reachable."}</p></div>
          </CardContent>
        </Card>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Clusters in inventory", value: inventory.data?.count ?? "—", note: "Airtable inventory rows", icon: Database },
          { label: "Reported healthy", value: summary?.counts.healthy ?? "—", note: "Snapshot health labels", icon: CheckCircle2 },
          { label: "Needs attention", value: (summary?.counts.warning ?? 0) + (summary?.counts.critical ?? 0), note: "Warning + critical", icon: AlertTriangle },
          { label: "Local agent", value: localOnline ? "Online" : "Offline", note: "Desktop kubectl telemetry", icon: Terminal },
          { label: "Average reported CPU", value: summary ? `${summary.averageReportedCPUPercent.toFixed(1)}%` : "—", note: "Airtable + agent readings", icon: Activity },
        ].map((stat) => (
          <Card key={stat.label} className="mission-panel">
            <CardContent className="p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{stat.label}</span><stat.icon className="h-4 w-4 text-cyan-200" /></div>
              <div className="mt-3 text-2xl font-semibold text-foreground">{stat.value}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">{stat.note}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-display text-base font-semibold text-foreground">Four-layer execution fabric</h2><span className="font-mono text-[9px] text-muted-foreground">SHARED INVENTORY + POLICY</span></div>
        <div className="grid gap-3 lg:grid-cols-3">
          <Card className="mission-panel">
            <CardHeader className="pb-2"><div className="flex items-center gap-2 text-cyan-200"><Server className="h-4 w-4" /><span className="font-mono text-[10px] uppercase tracking-widest">01 / Online server</span></div><CardTitle className="text-sm">Persistent Go API</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground"><p>Shared incident, inventory, analysis and automation API.</p><StatusPill value={inventory.data ? "inventory-connected" : "unavailable"} /><p>Inventory source: {inventory.data?.source ?? "not connected"}</p></CardContent>
          </Card>
          <Card className="mission-panel">
            <CardHeader className="pb-2"><div className="flex items-center gap-2 text-violet-200"><Cloud className="h-4 w-4" /><span className="font-mono text-[10px] uppercase tracking-widest">02 / Online serverless</span></div><CardTitle className="text-sm">Event-driven adapter</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground"><p>Same normalized data contract for Lambda/EventBridge execution.</p><StatusPill value="buildable-not-deployed" /><p>Deployment is separate; no false live status is shown.</p></CardContent>
          </Card>
          <Card className="mission-panel">
            <CardHeader className="pb-2"><div className="flex items-center gap-2 text-emerald-200"><Terminal className="h-4 w-4" /><span className="font-mono text-[10px] uppercase tracking-widest">03 / Offline Kubernetes</span></div><CardTitle className="text-sm">Desktop CLI agent</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground"><p>Outbound authenticated agent collects nodes, pods, events and top metrics.</p><StatusPill value={localOnline ? "connected" : "agent-offline"} /><p>Local Minikube must be running and agent configured.</p></CardContent>
          </Card>
        </div>
      </section>

      {inventory.data?.dataQuality && (
        <Card className="border-amber-300/20 bg-amber-300/[.035]">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-100"><Database className="h-4 w-4" /> Inventory provenance and freshness</div>
            <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-5">
              <div>Cluster rows: <strong className="text-foreground">{inventory.data.dataQuality.clusterRecordCount}</strong></div>
              <div>Node rows: <strong className="text-foreground">{inventory.data.dataQuality.nodeRecordCount}</strong></div>
              <div>Nodes linked to clusters: <strong className="text-foreground">{inventory.data.dataQuality.nodeRecordsWithClusterLinks}</strong></div>
              <div>Latest node Last Seen: <strong className="text-foreground">{inventory.data.dataQuality.latestNodeLastSeenAt ? new Date(inventory.data.dataQuality.latestNodeLastSeenAt).toLocaleDateString() : "Not available"}</strong></div>
              <div>Telemetry freshness: <strong className={inventory.data.dataQuality.telemetryFresh ? "text-emerald-300" : "text-amber-200"}>{inventory.data.dataQuality.telemetryFresh ? "Fresh" : "Stale / no agent"}</strong></div>
            </div>
            <p className="text-xs text-amber-100/75">{inventory.data.liveSyncEnabled ? "Live Airtable API sync is configured, but the cluster fields remain inventory snapshots rather than streaming metrics." : "Snapshot mode: a server-side Airtable PAT is not configured. Airtable values are inventory snapshots, not live telemetry."} The latest node Last Seen data is historical and the Airtable child tables currently have no cluster links. Live status is shown only after the desktop agent reports.</p>
          </CardContent>
        </Card>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-display text-base font-semibold text-foreground">Cluster inventory</h2><span className="font-mono text-[9px] text-muted-foreground">{clusters.length} RECORDS</span></div>
        <Card className="mission-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="border-b border-border/70 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="p-3">Cluster</th><th className="p-3">Environment</th><th className="p-3">Status</th><th className="p-3">Health</th><th className="p-3">Nodes / Pods</th><th className="p-3">Reported CPU</th><th className="p-3">Reported memory</th><th className="p-3">Data source</th></tr></thead>
              <tbody>
                {clusters.map((cluster) => (
                  <tr key={cluster.id} className="border-b border-border/40 last:border-0 hover:bg-white/[.025]">
                    <td className="p-3"><div className="font-medium text-foreground">{cluster.name}</div><div className="mt-1 font-mono text-[9px] text-muted-foreground">{cluster.id}</div></td>
                    <td className="p-3 text-muted-foreground">{cluster.environment}</td>
                    <td className="p-3"><StatusPill value={cluster.status} /></td>
                    <td className="p-3"><StatusPill value={cluster.healthStatus} /></td>
                    <td className="p-3 tabular-nums text-foreground">{cluster.readyNodeCount ?? "—"}/{cluster.nodeCount} / {cluster.podCount}</td>
                    <td className="p-3"><div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-700"><div className={`h-full rounded-full ${cluster.cpuUsagePercent >= 90 ? "bg-rose-400" : cluster.cpuUsagePercent >= 80 ? "bg-amber-300" : "bg-cyan-300"}`} style={{ width: `${Math.max(0,Math.min(100,cluster.cpuUsagePercent))}%` }} /></div><span className="tabular-nums text-foreground">{cluster.cpuUsagePercent}%</span></div></td>
                    <td className="p-3 tabular-nums text-foreground">{cluster.memoryUsageMB.toLocaleString()} MB</td>
                    <td className="p-3"><span className="font-mono text-[9px] text-muted-foreground">{cluster.source}</span></td>
                  </tr>
                ))}
                {!inventory.isLoading && clusters.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No inventory records returned.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <Card className="mission-panel">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><BrainCircuit className="h-4 w-4 text-violet-200" /> AI triage</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground"><p>Explainable rules evaluate CPU, reported health, cluster state and missing telemetry. Recommendations do not authorize changes.</p><Link to="/ai-insights" className="inline-flex items-center gap-1 text-cyan-200 hover:text-cyan-100">Open cluster analysis →</Link></CardContent>
        </Card>
        <Card className="mission-panel">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Workflow className="h-4 w-4 text-cyan-200" /> Zapier command queue</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground"><p>{commands.data?.items.length ?? 0} automation commands recorded in this API process.</p><p>Allowed CLI actions: collect snapshot, rollout status, and approval-gated deployment restart. Arbitrary shell is rejected.</p><div className="flex flex-wrap gap-2">{(commands.data?.items ?? []).slice(0,3).map((item) => <StatusPill key={item.id} value={item.status} />)}</div></CardContent>
        </Card>
      </section>
    </div>
  );
}
