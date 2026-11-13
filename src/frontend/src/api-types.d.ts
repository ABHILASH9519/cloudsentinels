export type CommentId = bigint;
export type IncidentId = bigint;
export type AlertId = bigint;
export type MetricPointId = bigint;

export interface Comment {
  id: CommentId;
  incidentId: IncidentId;
  createdAt: bigint;
  text: string;
  author: string;
}

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

export interface DashboardSummary {
  latestMetrics: MetricPoint[];
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

export interface AutomationEvent {
  id: string;
  ownerId: string | null;
  source: string;
  eventType: string;
  eventTime: string;
  createdAt: string;
  status: string;
  recommendedAction: string | null;
  procedureId: string | null;
  procedureVersion: number | null;
  risk: string;
  requiresApproval: boolean;
  clusterName: string | null;
  resourceId: string | null;
  severity: string | null;
  reason: string;
  recoveryVerified: boolean;
}

export enum UserRole {
  admin = "admin",
  user = "user",
  guest = "guest",
}

export interface backendInterface {
  addAlert(title: string, severity: string, source: string, message: string): Promise<AlertId>;
  addComment(incidentId: IncidentId, author: string, text: string): Promise<CommentId>;
  addMetric(name: string, value: number, unit: string, source: string): Promise<MetricPointId>;
  analyzeIncident(id: IncidentId): Promise<Incident>;
  assignCallerUserRole(user: string, role: UserRole): Promise<void>;
  createIncident(title: string, severity: string, source: string, rawLog: string): Promise<IncidentId>;
  deleteIncident(id: IncidentId): Promise<void>;
  getActiveAlerts(): Promise<Alert[]>;
  getAutomationEvents(): Promise<AutomationEvent[]>;
  getAlerts(): Promise<Alert[]>;
  getCallerUserProfile(): Promise<UserProfile | null>;
  getCallerUserRole(): Promise<UserRole>;
  getCommentsByIncident(incidentId: IncidentId): Promise<Comment[]>;
  getDashboardSummary(): Promise<DashboardSummary>;
  getIncident(id: IncidentId): Promise<Incident>;
  getMetricsByName(name: string): Promise<MetricPoint[]>;
  getRecentMetrics(count: bigint): Promise<MetricPoint[]>;
  getUserProfile(user: string): Promise<UserProfile | null>;
  isCallerAdmin(): Promise<boolean>;
  listIncidents(): Promise<Incident[]>;
  saveCallerUserProfile(profile: UserProfile): Promise<void>;
  updateAlertStatus(id: AlertId, status: string): Promise<void>;
  updateIncidentAIFields(id: IncidentId, aiSummary: string, rootCause: string, suggestedFix: string): Promise<void>;
  updateIncidentStatus(id: IncidentId, status: string): Promise<void>;
}
