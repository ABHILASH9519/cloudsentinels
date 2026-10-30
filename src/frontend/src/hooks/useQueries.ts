import demoDataset from "../../../../sample-data/demo-observability.json";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Alert,
  Comment,
  DashboardSummary,
  Incident,
  MetricPoint,
  UserProfile,
} from "../backend.d";
import { useActor } from "./useActor";

export function useDashboardSummary() {
  const { actor, isFetching } = useActor();
  return useQuery<DashboardSummary>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      if (!actor)
        return {
          latestMetrics: [],
          activeAlertsCount: 0n,
          incidentsBySeverity: [],
          incidentsByStatus: [],
        } as DashboardSummary;
      return actor.getDashboardSummary();
    },
    enabled: !!actor && !isFetching,
    refetchInterval: 30000,
  });
}

export function useListIncidents() {
  const { actor, isFetching } = useActor();
  return useQuery<Incident[]>({
    queryKey: ["incidents"],
    queryFn: async () => {
      if (!actor) return [];
      return actor.listIncidents();
    },
    enabled: !!actor && !isFetching,
  });
}

export function useGetIncident(id: bigint) {
  const { actor, isFetching } = useActor();
  return useQuery<Incident>({
    queryKey: ["incident", id.toString()],
    queryFn: async () => {
      if (!actor) throw new Error("No actor");
      return actor.getIncident(id);
    },
    enabled: !!actor && !isFetching,
  });
}

export function useGetComments(incidentId: bigint) {
  const { actor, isFetching } = useActor();
  return useQuery<Comment[]>({
    queryKey: ["comments", incidentId.toString()],
    queryFn: async () => {
      if (!actor) return [];
      return actor.getCommentsByIncident(incidentId);
    },
    enabled: !!actor && !isFetching,
  });
}

export function useGetAlerts() {
  const { actor, isFetching } = useActor();
  return useQuery<Alert[]>({
    queryKey: ["alerts"],
    queryFn: async () => {
      if (!actor) return [];
      return actor.getAlerts();
    },
    enabled: !!actor && !isFetching,
    refetchInterval: 15000,
  });
}

export function useGetActiveAlerts() {
  const { actor, isFetching } = useActor();
  return useQuery<Alert[]>({
    queryKey: ["alerts", "active"],
    queryFn: async () => {
      if (!actor) return [];
      return actor.getActiveAlerts();
    },
    enabled: !!actor && !isFetching,
    refetchInterval: 15000,
  });
}

export function useGetRecentMetrics(count: bigint) {
  const { actor, isFetching } = useActor();
  return useQuery<MetricPoint[]>({
    queryKey: ["metrics", count.toString()],
    queryFn: async () => {
      if (!actor) return [];
      return actor.getRecentMetrics(count);
    },
    enabled: !!actor && !isFetching,
    refetchInterval: 20000,
  });
}

export function useGetUserProfile() {
  const { actor, isFetching } = useActor();
  return useQuery<UserProfile | null>({
    queryKey: ["userProfile"],
    queryFn: async () => {
      if (!actor) return null;
      return actor.getCallerUserProfile();
    },
    enabled: !!actor && !isFetching,
  });
}

export function useCreateIncident() {
  const { actor } = useActor();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      title: string;
      severity: string;
      source: string;
      rawLog: string;
    }) => {
      if (!actor) throw new Error("No actor");
      return actor.createIncident(
        vars.title,
        vars.severity,
        vars.source,
        vars.rawLog,
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["incidents"] }),
  });
}

export function useUpdateIncidentStatus() {
  const { actor } = useActor();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: bigint; status: string }) => {
      if (!actor) throw new Error("No actor");
      return actor.updateIncidentStatus(vars.id, vars.status);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["incident", vars.id.toString()] });
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdateIncidentAIFields() {
  const { actor } = useActor();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: bigint;
      aiSummary: string;
      rootCause: string;
      suggestedFix: string;
    }) => {
      if (!actor) throw new Error("No actor");
      return actor.updateIncidentAIFields(
        vars.id,
        vars.aiSummary,
        vars.rootCause,
        vars.suggestedFix,
      );
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["incident", vars.id.toString()] });
      qc.invalidateQueries({ queryKey: ["incidents"] });
    },
  });
}

export function useDeleteIncident() {
  const { actor } = useActor();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: bigint) => {
      if (!actor) throw new Error("No actor");
      return actor.deleteIncident(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useAddComment() {
  const { actor } = useActor();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      incidentId: bigint;
      author: string;
      text: string;
    }) => {
      if (!actor) throw new Error("No actor");
      return actor.addComment(vars.incidentId, vars.author, vars.text);
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({
        queryKey: ["comments", vars.incidentId.toString()],
      }),
  });
}

export function useAddAlert() {
  const { actor } = useActor();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      title: string;
      severity: string;
      source: string;
      message: string;
    }) => {
      if (!actor) throw new Error("No actor");
      return actor.addAlert(
        vars.title,
        vars.severity,
        vars.source,
        vars.message,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useAddMetric() {
  const { actor } = useActor();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      name: string;
      value: number;
      unit: string;
      source: string;
    }) => {
      if (!actor) throw new Error("No actor");
      return actor.addMetric(vars.name, vars.value, vars.unit, vars.source);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["metrics"] }),
  });
}

export function useUpdateAlertStatus() {
  const { actor } = useActor();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: bigint; status: string }) => {
      if (!actor) throw new Error("No actor");
      return actor.updateAlertStatus(vars.id, vars.status);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useSaveUserProfile() {
  const { actor } = useActor();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (profile: UserProfile) => {
      if (!actor) throw new Error("No actor");
      return actor.saveCallerUserProfile(profile);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["userProfile"] }),
  });
}


/**
 * Import the repository's fictional observability fixture through the same
 * authenticated canister methods used by the UI. Matching source/title pairs
 * make the operation safe to retry after an interrupted import.
 */
export function useImportDemoData() {
  const { actor } = useActor();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!actor) throw new Error("Sign in before importing demo data");

      const [existingIncidents, existingAlerts, existingMetrics] =
        await Promise.all([
          actor.listIncidents(),
          actor.getAlerts(),
          actor.getRecentMetrics(200n),
        ]);

      let incidentsImported = 0;
      let metricsImported = 0;
      let alertsImported = 0;

      for (const item of demoDataset.incidents) {
        const source = `demo/${item.source}`;
        const existing = existingIncidents.find(
          (record) => record.title === item.title && record.source === source,
        );
        const id = existing
          ? existing.id
          : await actor.createIncident(
              item.title,
              item.severity,
              source,
              item.rawLog,
            );

        if (!existing) incidentsImported += 1;
        if (item.status !== "open") {
          await actor.updateIncidentStatus(id, item.status);
        }
        await actor.updateIncidentAIFields(
          id,
          item.aiSummary,
          item.rootCause,
          item.suggestedFix,
        );
      }

      for (const item of demoDataset.metrics) {
        const source = `demo/${item.source}`;
        const exists = existingMetrics.some(
          (record) => record.name === item.name && record.source === source,
        );
        if (!exists) {
          await actor.addMetric(item.name, item.value, item.unit, source);
          metricsImported += 1;
        }
      }

      for (const item of demoDataset.alerts) {
        const source = `demo/${item.source}`;
        const existing = existingAlerts.find(
          (record) => record.title === item.title && record.source === source,
        );
        const id = existing
          ? existing.id
          : await actor.addAlert(
              item.title,
              item.severity,
              source,
              item.message,
            );
        if (!existing) alertsImported += 1;
        if (item.status !== "active") {
          await actor.updateAlertStatus(id, item.status);
        }
      }

      return { incidentsImported, metricsImported, alertsImported };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["metrics"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
}
