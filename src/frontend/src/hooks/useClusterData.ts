import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cloudSentinelsRequest } from "../aws/cloudSentinelsApi";

export type ClusterRecord = {
  id: string;
  name: string;
  environment: string;
  status: string;
  healthStatus: string;
  nodeCount: number;
  readyNodeCount?: number;
  podCount: number;
  cpuUsagePercent: number;
  memoryUsageMB: number;
  recordCreatedAt?: string;
  lastSeenAt?: string;
  linkedNodeCount: number;
  source: string;
};

export type ClusterInventory = {
  source: string;
  baseId: string;
  generatedAt: string;
  dataQuality: {
    clusterRecordCount: number;
    nodeRecordCount: number;
    nodeRecordsWithClusterLinks: number;
    clustersWithLinkedNodes: number;
    latestInventoryCreatedAt?: string;
    latestNodeLastSeenAt?: string;
    inventoryAgeSeconds?: number;
    telemetryAgeSeconds?: number;
    telemetryFresh: boolean;
    notes: string[];
  };
  clusters: ClusterRecord[];
  count: number;
  liveSyncEnabled: boolean;
  modes: Array<{ id: string; label: string; description: string }>;
};

export type ClusterInsight = {
  id: string;
  clusterId: string;
  clusterName: string;
  environment: string;
  severity: string;
  category: string;
  title: string;
  summary: string;
  evidence: string[];
  recommendedActions: string[];
  confidence: number;
  source: string;
  generatedAt: string;
  requiresApproval: boolean;
};

export type InsightReport = {
  engine: string;
  generatedAt: string;
  disclaimer: string;
  insights: ClusterInsight[];
};

export type MonitoringSummary = {
  counts: Record<string, number>;
  averageReportedCPUPercent: number;
  clusters: ClusterRecord[];
  inventorySource: string;
  dataQuality: ClusterInventory["dataQuality"];
  localAgent: Array<{
    clusterId: string;
    context: string;
    nodeCount: number;
    readyNodeCount: number;
    podCount: number;
    healthyPodCount: number;
    warningEvents: number;
    cpuUsagePercent: number;
    memoryUsageMB: number;
    collectedAt: string;
    collector: string;
  }>;
  generatedAt: string;
};

export type AutomationCommand = {
  id: string;
  action: string;
  clusterId: string;
  namespace?: string;
  deployment?: string;
  approvalStatus: string;
  approvedBy?: string;
  status: string;
  result?: string;
  createdAt: string;
  updatedAt: string;
};

export function useClusterInventory() {
  return useQuery({
    queryKey: ["cloudsentinels", "clusters"],
    queryFn: () => cloudSentinelsRequest<ClusterInventory>("/api/v1/inventory/clusters"),
    refetchInterval: 30000,
    retry: 1,
  });
}

export function useClusterMonitoring() {
  return useQuery({
    queryKey: ["cloudsentinels", "monitoring"],
    queryFn: () => cloudSentinelsRequest<MonitoringSummary>("/api/v1/monitoring/summary"),
    refetchInterval: 15000,
    retry: 1,
  });
}

export function useClusterInsights() {
  return useQuery({
    queryKey: ["cloudsentinels", "insights"],
    queryFn: () => cloudSentinelsRequest<InsightReport>("/api/v1/ai/insights"),
    refetchInterval: 30000,
    retry: 1,
  });
}

export function useAutomationCommands() {
  return useQuery({
    queryKey: ["cloudsentinels", "automation", "commands"],
    queryFn: () => cloudSentinelsRequest<{ items: AutomationCommand[] }>("/api/v1/automation/commands"),
    refetchInterval: 15000,
    retry: 1,
  });
}

export function useRefreshAirtableInventory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => cloudSentinelsRequest<{ status: string }>("/api/v1/inventory/refresh", { method: "POST" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cloudsentinels", "clusters"] }),
        queryClient.invalidateQueries({ queryKey: ["cloudsentinels", "monitoring"] }),
        queryClient.invalidateQueries({ queryKey: ["cloudsentinels", "insights"] }),
      ]);
    },
  });
}

export function useTestZapierWebhook() {
  return useMutation({
    mutationFn: () => cloudSentinelsRequest<{ status: string }>("/api/v1/zapier/test", { method: "POST" }),
  });
}

export function useTriggerClusterAnalysis() {
  return useMutation({
    mutationFn: () => cloudSentinelsRequest<InsightReport>("/api/v1/ai/analyze", { method: "POST" }),
  });
}
