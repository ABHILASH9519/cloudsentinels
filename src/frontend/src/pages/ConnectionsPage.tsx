import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useClusterMonitoring, usePlatformStatus } from "../hooks/useClusterData";

const profiles = [
  { name: "Floci", description: "Local SQS and DynamoDB", configuration: "compose.yaml" },
  { name: "Docker Desktop", description: "Local Kubernetes agent", configuration: "run.ps1 -Action Agent -Context docker-desktop" },
  { name: "Minikube", description: "Separate local Kubernetes agent", configuration: "run.ps1 -Action Agent -Context cloudsentinels-local" },
  { name: "Amazon EKS", description: "Optional CloudFormation cluster profile", configuration: "deploy/eks/review-day-cluster.yaml" },
  { name: "AWS Lambda", description: "Optional Go SAM or Node.js operations runtime", configuration: "deploy/lambda/template.yaml" },
  { name: "n8n", description: "Incident classification and runbook automation", configuration: "deploy/automation/n8n-cloudsentinels-unified.json" },
  { name: "Zapier", description: "Optional outbound notification integration", configuration: "deploy/automation/ZAPIER.md" },
  { name: "Prometheus", description: "Optional monitoring rule definitions", configuration: "deploy/kubernetes/prometheus-rules.yaml" },
];

export function ConnectionsPage() {
  const platform = usePlatformStatus();
  const monitoring = useClusterMonitoring();
  return (
    <main className="mission-page space-y-6 p-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Connections</h1>
        <p className="text-sm text-muted-foreground">
          Prepared deployment profiles and status reported by the connected control plane.
        </p>
      </header>
      <Card className="mission-panel">
        <CardHeader><CardTitle>Control plane</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            {platform.data ? platform.data.executionMode : platform.isError ? "API unavailable" : "Checking API"}
          </p>
          {Object.entries(platform.data?.integrations ?? {}).map(([name, status]) => (
            <div className="flex items-center justify-between gap-4 text-sm" key={name}>
              <span>{name}</span><Badge variant="outline">{status}</Badge>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Configured integrations reflect API configuration. Agent status comes from telemetry.
          </p>
          {monitoring.data?.localAgent?.map((agent) => (
            <div key={agent.clusterId} className="border-t border-border pt-2 text-sm">
              <div>{agent.context} · {agent.readyNodeCount}/{agent.nodeCount} ready nodes</div>
              <div className="text-xs text-muted-foreground">Last collected {agent.collectedAt}</div>
            </div>
          ))}
        </CardContent>
      </Card>
      <section className="grid gap-4 sm:grid-cols-2" aria-label="Deployment profiles">
        {profiles.map(profile => (
          <Card key={profile.name} className="mission-panel">
            <CardHeader><CardTitle className="text-base">{profile.name}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">{profile.description}</p>
              <Badge variant="secondary">Configuration available</Badge>
              <p className="break-all font-mono text-xs text-muted-foreground">{profile.configuration}</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
