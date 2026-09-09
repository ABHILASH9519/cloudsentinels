import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export type CommentId = bigint;
export type IncidentId = bigint;
export interface Comment {
    id: CommentId;
    incidentId: IncidentId;
    createdAt: bigint;
    text: string;
    author: string;
}
export type AlertId = bigint;
export interface Incident {
    id: IncidentId;
    status: string;
    assignee: string;
    title: string;
    source: string;
    createdAt: bigint;
    updatedAt: bigint;
    aiSummary: string;
    suggestedFix: string;
    severity: string;
    rawLog: string;
    rootCause: string;
}
export type MetricPointId = bigint;
export interface DashboardSummary {
    latestMetrics: Array<MetricPoint>;
    activeAlertsCount: bigint;
    incidentsBySeverity: Array<[string, bigint]>;
    incidentsByStatus: Array<[string, bigint]>;
}
export interface MetricPoint {
    id: MetricPointId;
    value: number;
    source: string;
    name: string;
    unit: string;
    timestamp: bigint;
}
export interface UserProfile {
    name: string;
}
export interface Alert {
    id: AlertId;
    status: string;
    title: string;
    source: string;
    message: string;
    timestamp: bigint;
    severity: string;
}
export enum UserRole {
    admin = "admin",
    user = "user",
    guest = "guest"
}
export interface backendInterface {
    addAlert(title: string, severity: string, source: string, message: string): Promise<AlertId>;
    addComment(incidentId: IncidentId, author: string, text: string): Promise<CommentId>;
    addMetric(name: string, value: number, unit: string, source: string): Promise<MetricPointId>;
    assignCallerUserRole(user: Principal, role: UserRole): Promise<void>;
    createIncident(title: string, severity: string, source: string, rawLog: string): Promise<IncidentId>;
    deleteIncident(id: IncidentId): Promise<void>;
    getActiveAlerts(): Promise<Array<Alert>>;
    getAlerts(): Promise<Array<Alert>>;
    getCallerUserProfile(): Promise<UserProfile | null>;
    getCallerUserRole(): Promise<UserRole>;
    getCommentsByIncident(incidentId: IncidentId): Promise<Array<Comment>>;
    getDashboardSummary(): Promise<DashboardSummary>;
    getIncident(id: IncidentId): Promise<Incident>;
    getMetricsByName(name: string): Promise<Array<MetricPoint>>;
    getRecentMetrics(count: bigint): Promise<Array<MetricPoint>>;
    getUserProfile(user: Principal): Promise<UserProfile | null>;
    isCallerAdmin(): Promise<boolean>;
    listIncidents(): Promise<Array<Incident>>;
    saveCallerUserProfile(profile: UserProfile): Promise<void>;
    updateAlertStatus(id: AlertId, status: string): Promise<void>;
    updateIncidentAIFields(id: IncidentId, aiSummary: string, rootCause: string, suggestedFix: string): Promise<void>;
    updateIncidentStatus(id: IncidentId, status: string): Promise<void>;
}
