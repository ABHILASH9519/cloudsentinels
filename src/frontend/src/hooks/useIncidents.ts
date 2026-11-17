import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cloudSentinelsRequest } from "../lib/cloudSentinels";

export type IncidentStatus =
  | "open"
  | "acknowledged"
  | "investigating"
  | "resolved";

export type Incident = {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: IncidentStatus;
  source: string;
  target: string;
  detectedAt: string;
  correlationId?: string;
  assignee?: string;
  rawLog?: string;
  aiSummary?: string;
  rootCause?: string;
  suggestedFix?: string;
  createdAt: string;
  updatedAt: string;
};

export type IncidentComment = {
  id: string;
  incidentId: string;
  author: string;
  text: string;
  createdAt: string;
};

type IncidentList = { items: Incident[]; count: number };
type CommentList = { items: IncidentComment[]; count: number };

const incidentsKey = ["incidents"] as const;
const incidentKey = (id: string) => ["incident", id] as const;
const commentsKey = (id: string) => ["comments", id] as const;

export function useListIncidents() {
  return useQuery<Incident[]>({
    queryKey: incidentsKey,
    // The Go API returns {items, count}; the page renders a plain array.
    queryFn: async () => {
      const body = await cloudSentinelsRequest<IncidentList>(
        "/api/v1/incidents",
      );
      return body.items ?? [];
    },
  });
}

export function useGetIncident(id: string) {
  return useQuery<Incident>({
    queryKey: incidentKey(id),
    queryFn: () => cloudSentinelsRequest<Incident>(`/api/v1/incidents/${id}`),
    enabled: Boolean(id),
  });
}

export function useGetComments(id: string) {
  return useQuery<IncidentComment[]>({
    queryKey: commentsKey(id),
    queryFn: async () => {
      const body = await cloudSentinelsRequest<CommentList>(
        `/api/v1/incidents/${id}/comments`,
      );
      return body.items ?? [];
    },
    enabled: Boolean(id),
  });
}

export type CreateIncidentInput = {
  title: string;
  severity: string;
  source: string;
  rawLog?: string;
};

export function useCreateIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIncidentInput) =>
      cloudSentinelsRequest<Incident>("/api/v1/incidents", {
        method: "POST",
        body: JSON.stringify({
          title: input.title,
          severity: input.severity,
          source: input.source,
          ...(input.rawLog
            ? { rawLog: input.rawLog, description: input.rawLog }
            : {}),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: incidentsKey });
    },
  });
}

export function useUpdateIncidentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; status: string }) =>
      cloudSentinelsRequest<Incident>(`/api/v1/incidents/${vars.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: vars.status }),
      }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: incidentKey(vars.id) });
      queryClient.invalidateQueries({ queryKey: incidentsKey });
    },
  });
}

export function useUpdateIncidentAIFields() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      id: string;
      aiSummary: string;
      rootCause: string;
      suggestedFix: string;
    }) =>
      cloudSentinelsRequest<Incident>(`/api/v1/incidents/${vars.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          aiSummary: vars.aiSummary,
          rootCause: vars.rootCause,
          suggestedFix: vars.suggestedFix,
        }),
      }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: incidentKey(vars.id) });
      queryClient.invalidateQueries({ queryKey: incidentsKey });
    },
  });
}

export function useAnalyzeIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      cloudSentinelsRequest<Incident>(`/api/v1/incidents/${id}/analyze`, {
        method: "POST",
      }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: incidentKey(id) });
      queryClient.invalidateQueries({ queryKey: incidentsKey });
    },
  });
}

export function useDeleteIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      cloudSentinelsRequest<void>(`/api/v1/incidents/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: incidentKey(id) });
      queryClient.removeQueries({ queryKey: commentsKey(id) });
      queryClient.invalidateQueries({ queryKey: incidentsKey });
    },
  });
}

export function useAddComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { incidentId: string; text: string }) =>
      cloudSentinelsRequest<IncidentComment>(
        `/api/v1/incidents/${vars.incidentId}/comments`,
        { method: "POST", body: JSON.stringify({ text: vars.text }) },
      ),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: commentsKey(vars.incidentId) });
    },
  });
}
