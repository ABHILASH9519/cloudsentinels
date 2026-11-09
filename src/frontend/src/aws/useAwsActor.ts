import { useMemo } from "react";
import type { backendInterface, Incident, Alert, MetricPoint, Comment, DashboardSummary, UserProfile, UserRole } from "../backend.d";
import { awsRequest } from "./api";
import { useAwsAuth } from "./AwsAuth";

const toBig = (value: string | number | bigint) => BigInt(value);
const stamp = (value: string | number | undefined) => BigInt(Math.floor(new Date(value ?? Date.now()).getTime()) * 1_000_000);
function incident(row: any): Incident {
  return { id: toBig(row.id), title: row.title, severity: row.severity, status: row.status, source: row.source, rawLog: row.rawLog, aiSummary: row.aiSummary ?? "", rootCause: row.rootCause ?? "", suggestedFix: row.suggestedFix ?? "", assignee: row.assignee ?? "", createdAt: stamp(row.createdAt), updatedAt: stamp(row.updatedAt) };
}
function alertItem(row: any): Alert {
  return { id: toBig(row.id), title: row.title, severity: row.severity, source: row.source, message: row.message, status: row.status, timestamp: stamp(row.timestamp) };
}
function metric(row: any): MetricPoint {
  return { id: toBig(row.id), name: row.name, value: row.value, unit: row.unit, source: row.source, timestamp: stamp(row.timestamp) };
}
function comment(row: any): Comment {
  return { id: toBig(row.id), incidentId: toBig(row.incidentId), author: row.author, text: row.text, createdAt: stamp(row.createdAt) };
}

export function useAwsActor() {
  const auth = useAwsAuth();
  const actor = useMemo<backendInterface | null>(() => {
    if (!auth.isSignedIn) return null;
    const request = <T,>(path: string, method = "GET", body?: unknown) =>
      awsRequest<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const actor: backendInterface = {
      async createIncident(title, severity, source, rawLog) { const row = await request<any>("/incidents", "POST", { title, severity, source, rawLog }); return toBig(row.id); },
      async listIncidents() { return (await request<any[]>("/incidents")).map(incident); },
      async getIncident(id) { return incident(await request<any>(`/incidents/${id}`)); },
      async updateIncidentStatus(id, status) { await request(`/incidents/${id}`, "PATCH", { status }); },
      async updateIncidentAIFields(id, aiSummary, rootCause, suggestedFix) { await request(`/incidents/${id}`, "PATCH", { aiSummary, rootCause, suggestedFix }); },
      async deleteIncident(id) { await request(`/incidents/${id}`, "DELETE"); },
      async addComment(incidentId, _author, text) { const row = await request<any>(`/incidents/${incidentId}/comments`, "POST", { text }); return toBig(row.id); },
      async getCommentsByIncident(id) { return (await request<any[]>(`/incidents/${id}/comments`)).map(comment); },
      async addMetric(name, value, unit, source) { const row = await request<any>("/metrics", "POST", { name, value, unit, source }); return toBig(row.id); },
      async getMetricsByName(name) { return (await request<any[]>("/metrics")).filter(row => row.name === name).map(metric); },
      async getRecentMetrics(count) { return (await request<any[]>("/metrics")).slice(-Number(count)).reverse().map(metric); },
      async addAlert(title, severity, source, message) { const row = await request<any>("/alerts", "POST", { title, severity, source, message }); return toBig(row.id); },
      async getAlerts() { return (await request<any[]>("/alerts")).map(alertItem); },
      async getActiveAlerts() { return (await request<any[]>("/alerts")).filter(row => row.status === "active").map(alertItem); },
      async updateAlertStatus(id, status) { await request(`/alerts/${id}`, "PATCH", { status }); },
      async getDashboardSummary() {
        const [incidents, alerts, metrics] = await Promise.all([request<any[]>("/incidents"), request<any[]>("/alerts"), request<any[]>("/metrics")]);
        const count = (key: string) => Object.entries(incidents.reduce((acc: Record<string, number>, row) => ({ ...acc, [row[key]]: (acc[row[key]] ?? 0) + 1 }), {})).map(([k,v]) => [k, BigInt(v)] as [string,bigint]);
        return { incidentsByStatus: count("status"), incidentsBySeverity: count("severity"), activeAlertsCount: BigInt(alerts.filter(row => row.status === "active").length), latestMetrics: metrics.slice(-10).reverse().map(metric) } as DashboardSummary;
      },
      async getCallerUserProfile() { return request<UserProfile | null>("/profile").catch(() => null); },
      async getUserProfile() { return request<UserProfile | null>("/profile").catch(() => null); },
      async saveCallerUserProfile(profile) { await request("/profile", "PUT", profile); },
      async getCallerUserRole() { return "user" as UserRole; },
      async isCallerAdmin() { return false; },
      async assignCallerUserRole() { throw new Error("Role changes require an AWS administrator workflow."); },
    };
    return actor;
  }, [auth.isSignedIn]);
  return { actor, isFetching: !auth.isLoaded, error: auth.error ? new Error(auth.error) : null };
}
