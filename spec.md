# CloudSentinels - AI-Powered DevOps Assistant

## Current State
New project. No existing code.

## Requested Changes (Diff)

### Add
- Role-based authentication (Admin, Engineer, Viewer) using built-in Internet Identity
- Incident Dashboard: create, view, and manage incidents with AI-generated root cause summaries and fix suggestions (pushed in from external Python/AI backend)
- Live Monitoring Hub: display real-time metrics (CPU, memory, error rates), active alerts feed, and anomaly detection results ingested via HTTP API
- Incident Management: assign incidents to users, comment, update status (Open, In Progress, Resolved), track history
- AI Insights Panel: store and display AI summaries, anomaly findings, and suggested fixes
- Metrics Visualization: charts showing system health trends over time
- HTTP ingestion API endpoint for external Python backend to push logs, alerts, metrics, and AI analysis results

### Modify
- N/A

### Remove
- N/A

## Implementation Plan
1. Backend (Motoko):
   - User roles: Admin, Engineer, Viewer
   - Incidents: id, title, severity, status, source, rawLog, aiSummary, rootCause, suggestedFix, assignee, createdAt, updatedAt
   - Comments: id, incidentId, author, text, createdAt
   - Metrics: id, name, value, unit, timestamp, source
   - Alerts: id, title, severity, source, message, status, timestamp
   - HTTP ingestion endpoints to receive data from external backend
   - CRUD for incidents, comments, alerts, metrics
   - Role-based access control

2. Frontend:
   - Login page with Internet Identity auth
   - Sidebar navigation: Dashboard, Incidents, Monitoring, AI Insights, Settings
   - Dashboard overview: incident counts by severity, recent alerts, system health summary
   - Incidents list with filters (status, severity), detail view with AI analysis and comments
   - Create incident form (manual entry or paste raw log)
   - Monitoring hub: metrics charts (line/area charts), live alerts feed
   - AI Insights panel: list of AI summaries, anomaly reports, fix suggestions
   - Settings: user management (Admin only), role assignment
