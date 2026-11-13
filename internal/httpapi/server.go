package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/ABHILASH9519/cloudsentinels/internal/analysis"
	"github.com/ABHILASH9519/cloudsentinels/internal/auth"
	"github.com/ABHILASH9519/cloudsentinels/internal/automation"
	"github.com/ABHILASH9519/cloudsentinels/internal/config"
	"github.com/ABHILASH9519/cloudsentinels/internal/domain"
	"github.com/ABHILASH9519/cloudsentinels/internal/inventory"
)

type Authenticator interface {
	Authenticate(*http.Request) (auth.Principal, error)
}

type LocalTelemetry struct {
	ClusterID       string    `json:"clusterId"`
	Context         string    `json:"context"`
	NodeCount       int       `json:"nodeCount"`
	ReadyNodeCount  int       `json:"readyNodeCount"`
	PodCount        int       `json:"podCount"`
	HealthyPodCount int       `json:"healthyPodCount"`
	WarningEvents   int       `json:"warningEvents"`
	CPUUsagePercent float64   `json:"cpuUsagePercent,omitempty"`
	MemoryUsageMB   float64   `json:"memoryUsageMB,omitempty"`
	CollectedAt     time.Time `json:"collectedAt"`
	Collector       string    `json:"collector"`
}

type Server struct {
	config              config.Config
	logger              *slog.Logger
	authenticator       Authenticator
	inventory           *inventory.Store
	automationQueue     *automation.Queue
	zapier              *automation.Dispatcher
	incidentsMu         sync.RWMutex
	incidents           map[string]domain.Incident
	telemetryMu         sync.RWMutex
	localTelemetry      map[string]LocalTelemetry
	automationMu        sync.Mutex
	lastAutomationEvent map[string]time.Time
}

func NewServer(cfg config.Config, logger *slog.Logger, authenticator Authenticator) *Server {
	return NewServerWithServices(cfg, logger, authenticator, nil, nil, nil)
}

func NewServerWithServices(cfg config.Config, logger *slog.Logger, authenticator Authenticator, inventoryStore *inventory.Store, queue *automation.Queue, dispatcher *automation.Dispatcher) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	if queue == nil {
		queue = automation.NewQueue()
	}
	return &Server{
		config: cfg, logger: logger, authenticator: authenticator,
		inventory: inventoryStore, automationQueue: queue, zapier: dispatcher,
		incidents: make(map[string]domain.Incident), localTelemetry: make(map[string]LocalTelemetry),
		lastAutomationEvent: make(map[string]time.Time),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /readyz", s.ready)
	mux.HandleFunc("GET /api/v1/platform", s.platform)
	mux.HandleFunc("GET /api/v1/incidents", s.listIncidents)
	mux.HandleFunc("POST /api/v1/incidents", s.createIncident)
	mux.HandleFunc("GET /api/v1/inventory/clusters", s.listClusters)
	mux.HandleFunc("POST /api/v1/inventory/refresh", s.refreshInventory)
	mux.HandleFunc("GET /api/v1/monitoring/summary", s.monitoringSummary)
	mux.HandleFunc("GET /api/v1/ai/insights", s.aiInsights)
	mux.HandleFunc("POST /api/v1/ai/analyze", s.runAIAnalysis)
	mux.HandleFunc("POST /api/v1/zapier/commands", s.zapierCommand)
	mux.HandleFunc("POST /api/v1/zapier/test", s.testZapier)
	mux.HandleFunc("GET /api/v1/automation/commands", s.listAutomationCommands)
	mux.HandleFunc("GET /api/v1/agent/commands", s.agentCommands)
	mux.HandleFunc("POST /api/v1/agent/commands/{id}/result", s.agentCommandResult)
	mux.HandleFunc("POST /api/v1/agent/telemetry", s.agentTelemetry)
	mux.HandleFunc("GET /api/v1/agent/telemetry", s.getAgentTelemetry)
	return s.requestLogger(securityHeaders(s.cors(mux)))
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "cloudsentinels"})
}
func (s *Server) ready(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready", "executionMode": s.config.ExecutionMode})
}
func (s *Server) platform(w http.ResponseWriter, _ *http.Request) {
	airtableStatus := "snapshot-unavailable"
	if s.inventory != nil {
		airtableStatus = s.inventory.Snapshot().Source
	}
	localStatus := "agent-offline"
	s.telemetryMu.RLock()
	for _, telemetry := range s.localTelemetry {
		if time.Since(telemetry.CollectedAt) < 2*time.Minute {
			localStatus = "connected"
		}
	}
	s.telemetryMu.RUnlock()
	zapierStatus := "not-configured"
	if s.zapier != nil && s.zapier.Enabled() {
		zapierStatus = "configured"
	}
	serverlessStatus, serverlessDeployment := "shared-contract-ready", "not-deployed"
	if s.config.ExecutionMode == "online-serverless" {
		serverlessStatus, serverlessDeployment = "running", "lambda"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"service": "cloudsentinels", "version": s.config.BuildVersion, "executionMode": s.config.ExecutionMode,
		"components": []map[string]string{
			{"id": "online-server", "status": "inventory-connected", "inventory": airtableStatus},
			{"id": "online-serverless", "status": serverlessStatus, "deployment": serverlessDeployment},
			{"id": "offline-kubernetes", "status": localStatus},
		},
		"integrations": map[string]string{"airtable": airtableStatus, "zapier": zapierStatus, "desktopAgent": localStatus},
		"core":         map[string]string{"incidentDetection": "go-api", "aiAnalysis": "explainable-rules-engine", "remediation": "approval-gated-cli-queue"},
	})
}

func (s *Server) listIncidents(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	s.incidentsMu.RLock()
	defer s.incidentsMu.RUnlock()
	items := make([]domain.Incident, 0, len(s.incidents))
	for _, item := range s.incidents {
		items = append(items, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "count": len(items), "storage": "process-memory-demo"})
}

func (s *Server) createIncident(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var item domain.Incident
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&item); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "request_too_large", "Incident request body exceeds the 1 MiB limit")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body is not valid incident JSON")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body must contain exactly one JSON object")
		return
	}
	if item.Status == "" {
		item.Status = domain.StatusOpen
	}
	if err := item.Validate(); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_incident", err.Error())
		return
	}
	if item.ID == "" {
		id, err := newID()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "id_generation_failed", "Could not generate an incident identifier")
			return
		}
		item.ID = id
	}
	if item.DetectedAt.IsZero() {
		item.DetectedAt = time.Now().UTC()
	}
	s.incidentsMu.Lock()
	if _, exists := s.incidents[item.ID]; exists {
		s.incidentsMu.Unlock()
		writeError(w, http.StatusConflict, "incident_exists", "An incident with this identifier already exists")
		return
	}
	s.incidents[item.ID] = item
	s.incidentsMu.Unlock()
	s.emitZapierEvent("incident:"+item.ID, automation.Event{EventType: "incident.created", EventID: item.ID, Severity: string(item.Severity), Title: item.Title, Summary: item.Description}, 0)
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) listClusters(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	if s.inventory == nil {
		writeError(w, http.StatusServiceUnavailable, "inventory_unavailable", "Airtable inventory snapshot is not configured")
		return
	}
	snapshot := s.inventory.Snapshot()
	clusters := mergeLocalTelemetry(append([]inventory.Cluster(nil), snapshot.Clusters...), s.localTelemetrySnapshot())
	writeJSON(w, http.StatusOK, map[string]any{
		"source": snapshot.Source, "baseId": snapshot.BaseID, "generatedAt": snapshot.GeneratedAt,
		"dataQuality": snapshot.DataQuality, "clusters": clusters, "count": len(clusters), "liveSyncEnabled": s.inventory.LiveSyncEnabled(),
		"modes": []map[string]string{
			{"id": "online-server", "label": "Online server", "description": "Shared CloudSentinels API and remote inventory/agent telemetry."},
			{"id": "online-serverless", "label": "Online serverless", "description": "Same normalized inventory and analysis contract; Lambda adapter deployment remains separate."},
			{"id": "offline-kubernetes", "label": "Offline Kubernetes", "description": "Local desktop agent uses a fixed kubectl allowlist and outbound authenticated polling."},
		},
	})
}

func (s *Server) refreshInventory(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	if s.inventory == nil {
		writeError(w, http.StatusServiceUnavailable, "inventory_unavailable", "Inventory is not configured")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	if err := s.inventory.Refresh(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "inventory_refresh_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "refreshed", "generatedAt": s.inventory.Snapshot().GeneratedAt})
}

func (s *Server) monitoringSummary(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	if s.inventory == nil {
		writeError(w, http.StatusServiceUnavailable, "inventory_unavailable", "Inventory is not configured")
		return
	}
	snapshot := s.inventory.Snapshot()
	clusters := mergeLocalTelemetry(append([]inventory.Cluster(nil), snapshot.Clusters...), s.localTelemetrySnapshot())
	counts := map[string]int{"total": len(clusters), "healthy": 0, "warning": 0, "critical": 0, "offline": 0}
	var cpuTotal float64
	cpuSamples := 0
	for _, c := range clusters {
		if strings.EqualFold(c.Status, "offline") || strings.EqualFold(c.HealthStatus, "offline") {
			counts["offline"]++
		}
		switch strings.ToLower(c.HealthStatus) {
		case "healthy":
			counts["healthy"]++
		case "warning":
			counts["warning"]++
		case "critical":
			counts["critical"]++
		}
		if !strings.EqualFold(c.Status, "offline") && (c.Source == "desktop_agent" || c.CPUUsagePercent > 0) {
			cpuTotal += c.CPUUsagePercent
			cpuSamples++
		}
	}
	averageCPU := 0.0
	if cpuSamples > 0 {
		averageCPU = cpuTotal / float64(cpuSamples)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"counts": counts, "averageReportedCPUPercent": averageCPU, "clusters": clusters,
		"inventorySource": snapshot.Source, "dataQuality": snapshot.DataQuality,
		"localAgent": s.localTelemetrySnapshot(), "generatedAt": time.Now().UTC(),
	})
}

func (s *Server) aiInsights(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	if s.inventory == nil {
		writeError(w, http.StatusServiceUnavailable, "inventory_unavailable", "Inventory is not configured")
		return
	}
	snapshot := s.inventory.Snapshot()
	snapshot.Clusters = mergeLocalTelemetry(snapshot.Clusters, s.localTelemetrySnapshot())
	writeJSON(w, http.StatusOK, analysis.Analyze(snapshot))
}

func (s *Server) runAIAnalysis(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	if s.inventory == nil {
		writeError(w, http.StatusServiceUnavailable, "inventory_unavailable", "Inventory is not configured")
		return
	}
	snapshot := s.inventory.Snapshot()
	snapshot.Clusters = mergeLocalTelemetry(snapshot.Clusters, s.localTelemetrySnapshot())
	report := analysis.Analyze(snapshot)
	for _, insight := range report.Insights {
		if insight.Severity != "critical" && insight.Severity != "high" {
			continue
		}
		s.emitZapierEvent("ai:"+insight.ID, automation.Event{
			EventType: "cluster.ai_finding", EventID: insight.ID, ClusterID: insight.ClusterID,
			Severity: insight.Severity, Title: insight.Title, Summary: insight.Summary,
		}, 10*time.Minute)
	}
	writeJSON(w, http.StatusOK, report)
}

func (s *Server) emitZapierEvent(key string, event automation.Event, cooldown time.Duration) {
	if s.zapier == nil || !s.zapier.Enabled() {
		return
	}
	now := time.Now().UTC()
	s.automationMu.Lock()
	if previous, ok := s.lastAutomationEvent[key]; ok && cooldown > 0 && now.Sub(previous) < cooldown {
		s.automationMu.Unlock()
		return
	}
	s.lastAutomationEvent[key] = now
	s.automationMu.Unlock()
	go func() {
		if err := s.zapier.Send(event); err != nil {
			s.logger.Warn("Zapier event delivery failed", "event_type", event.EventType, "error", err)
		}
	}()
}

func (s *Server) zapierCommand(w http.ResponseWriter, r *http.Request) {
	if s.config.ExecutionMode == "online-serverless" {
		writeError(w, http.StatusServiceUnavailable, "serverless_command_queue_unavailable", "Route local CLI commands through the persistent online-server control plane")
		return
	}
	if s.config.ZapierSigningSecret == "" {
		writeError(w, http.StatusServiceUnavailable, "zapier_not_configured", "Configure ZAPIER_SIGNING_SECRET before accepting Zapier callbacks")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Could not read webhook body")
		return
	}
	if err := automation.Verify(s.config.ZapierSigningSecret, r.Header.Get("X-CS-Timestamp"), r.Header.Get("X-CS-Signature"), body, time.Now().UTC()); err != nil {
		writeError(w, http.StatusUnauthorized, "invalid_webhook_signature", "Webhook signature or timestamp is invalid")
		return
	}
	var input struct {
		CommandID      string `json:"commandId"`
		Action         string `json:"action"`
		ClusterID      string `json:"clusterId"`
		Namespace      string `json:"namespace"`
		Deployment     string `json:"deployment"`
		ApprovalStatus string `json:"approvalStatus"`
		ApprovedBy     string `json:"approvedBy"`
		RequestedBy    string `json:"requestedBy"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_command", "Webhook command JSON is invalid")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid_command", "Webhook body must contain exactly one JSON object")
		return
	}
	if input.Action == "restart-deployment" && !s.config.AllowLocalMutations {
		writeError(w, http.StatusForbidden, "mutations_disabled", "Local CLI mutations are disabled by server policy")
		return
	}
	command, err := s.automationQueue.Enqueue(automation.Command{
		ID: input.CommandID, Action: input.Action, ClusterID: input.ClusterID,
		Namespace: input.Namespace, Deployment: input.Deployment,
		ApprovalStatus: input.ApprovalStatus, ApprovedBy: input.ApprovedBy, RequestedBy: input.RequestedBy,
	})
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "command_rejected", err.Error())
		return
	}
	if s.zapier != nil && s.zapier.Enabled() {
		go func() {
			_ = s.zapier.Send(automation.Event{EventType: "automation.command_queued", EventID: command.ID, ClusterID: command.ClusterID, Severity: "info", Title: command.Action, Summary: "A signed automation request was queued for the local agent."})
		}()
	}
	writeJSON(w, http.StatusAccepted, command)
}

func (s *Server) testZapier(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	if s.zapier == nil || !s.zapier.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "zapier_not_configured", "Configure the private Zapier Catch Hook URL and signing secret")
		return
	}
	err := s.zapier.Send(automation.Event{EventType: "cloudsentinels.integration_test", Severity: "info", Title: "CloudSentinels webhook test", Summary: "The outbound Zapier webhook connection is being tested."})
	if err != nil {
		writeError(w, http.StatusBadGateway, "zapier_delivery_failed", "Zapier webhook delivery failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "delivered_to_catch_hook"})
}

func (s *Server) listAutomationCommands(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": s.automationQueue.List()})
}

func (s *Server) agentCommands(w http.ResponseWriter, r *http.Request) {
	clusterID := r.URL.Query().Get("clusterId")
	if !s.authorizeAgent(w, r, clusterID) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": s.automationQueue.PendingForCluster(clusterID, 20)})
}

func (s *Server) agentCommandResult(w http.ResponseWriter, r *http.Request) {
	clusterID := r.URL.Query().Get("clusterId")
	if !s.authorizeAgent(w, r, clusterID) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
	var input struct {
		Status string `json:"status"`
		Result string `json:"result"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_result", "Command result JSON is invalid")
		return
	}
	item, ok := s.automationQueue.CompleteForCluster(r.PathValue("id"), clusterID, input.Status, input.Result)
	if !ok {
		writeError(w, http.StatusNotFound, "command_not_found", "Command ID was not found")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) agentTelemetry(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	var telemetry LocalTelemetry
	if err := json.NewDecoder(r.Body).Decode(&telemetry); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_telemetry", "Telemetry JSON is invalid")
		return
	}
	if !s.authorizeAgent(w, r, telemetry.ClusterID) {
		return
	}
	if telemetry.ClusterID == "" || len(telemetry.ClusterID) > 128 || telemetry.Context == "" || len(telemetry.Context) > 128 || telemetry.NodeCount < 0 || telemetry.ReadyNodeCount < 0 || telemetry.ReadyNodeCount > telemetry.NodeCount || telemetry.PodCount < 0 || telemetry.HealthyPodCount < 0 || telemetry.HealthyPodCount > telemetry.PodCount || telemetry.WarningEvents < 0 || telemetry.CPUUsagePercent < 0 || telemetry.CPUUsagePercent > 100 || telemetry.MemoryUsageMB < 0 {
		writeError(w, http.StatusUnprocessableEntity, "invalid_telemetry", "Telemetry fields are outside allowed bounds")
		return
	}
	if telemetry.CollectedAt.IsZero() {
		telemetry.CollectedAt = time.Now().UTC()
	}
	telemetry.Collector = "cloudsentinels-desktop-agent"
	s.telemetryMu.Lock()
	s.localTelemetry[telemetry.ClusterID] = telemetry
	s.telemetryMu.Unlock()
	if telemetry.WarningEvents > 0 {
		s.emitZapierEvent("warning:"+telemetry.ClusterID, automation.Event{EventType: "cluster.warning", ClusterID: telemetry.ClusterID, Severity: "high", Title: "Kubernetes warning events detected", Summary: "The desktop agent reported warning events; inspect the latest telemetry and cluster events."}, 5*time.Minute)
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"status": "accepted", "clusterId": telemetry.ClusterID, "collectedAt": telemetry.CollectedAt})
}

func (s *Server) getAgentTelemetry(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": s.localTelemetrySnapshot()})
}

func (s *Server) localTelemetrySnapshot() []LocalTelemetry {
	s.telemetryMu.RLock()
	defer s.telemetryMu.RUnlock()
	items := make([]LocalTelemetry, 0, len(s.localTelemetry))
	for _, t := range s.localTelemetry {
		items = append(items, t)
	}
	return items
}

func mergeLocalTelemetry(clusters []inventory.Cluster, telemetry []LocalTelemetry) []inventory.Cluster {
	for _, t := range telemetry {
		if strings.TrimSpace(t.ClusterID) == "" {
			continue
		}
		status, health := "Active", "Healthy"
		if t.WarningEvents > 0 || t.ReadyNodeCount < t.NodeCount || t.HealthyPodCount < t.PodCount {
			health = "Warning"
		}
		stale := t.CollectedAt.IsZero() || time.Since(t.CollectedAt) > 2*time.Minute
		if stale {
			status, health = "Offline", "Unknown"
		}
		found := false
		for i := range clusters {
			if clusters[i].ID != t.ClusterID {
				continue
			}
			found = true
			clusters[i].NodeCount = t.NodeCount
			clusters[i].ReadyNodeCount = t.ReadyNodeCount
			clusters[i].PodCount = t.PodCount
			if t.CPUUsagePercent > 0 || t.MemoryUsageMB > 0 {
				clusters[i].CPUUsagePercent = t.CPUUsagePercent
				clusters[i].MemoryUsageMB = t.MemoryUsageMB
			}
			clusters[i].LastSeenAt = t.CollectedAt.Format(time.RFC3339)
			clusters[i].Source = "desktop_agent"
			clusters[i].Status, clusters[i].HealthStatus = status, health
			break
		}
		if !found {
			clusters = append(clusters, inventory.Cluster{
				ID: t.ClusterID, Name: t.Context, Environment: "Local", Status: status,
				HealthStatus: health, NodeCount: t.NodeCount, ReadyNodeCount: t.ReadyNodeCount, PodCount: t.PodCount,
				CPUUsagePercent: t.CPUUsagePercent, MemoryUsageMB: t.MemoryUsageMB,
				LastSeenAt: t.CollectedAt.Format(time.RFC3339), Source: "desktop_agent",
			})
		}
	}
	return clusters
}

func (s *Server) authorize(w http.ResponseWriter, r *http.Request) bool {
	if s.authenticator == nil {
		writeError(w, http.StatusServiceUnavailable, "authentication_unconfigured", "Protected API routes are disabled until Cognito or local authentication is configured")
		return false
	}
	if _, err := s.authenticator.Authenticate(r); err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "A valid authenticated session is required")
		return false
	}
	return true
}
func (s *Server) authorizeAgent(w http.ResponseWriter, r *http.Request, clusterID string) bool {
	if strings.TrimSpace(clusterID) == "" {
		writeError(w, http.StatusBadRequest, "agent_cluster_required", "Agent requests must identify their registered cluster")
		return false
	}
	expected := s.config.AgentToken
	if len(s.config.AgentTokens) > 0 {
		expected = s.config.AgentTokens[clusterID]
		if expected == "" {
			writeError(w, http.StatusUnauthorized, "agent_cluster_unregistered", "No agent credential is registered for this cluster")
			return false
		}
	}
	if expected == "" {
		writeError(w, http.StatusServiceUnavailable, "agent_auth_unconfigured", "CLOUDSENTINELS_AGENT_TOKEN is not configured")
		return false
	}
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if !strings.HasPrefix(strings.ToLower(header), "bearer ") {
		writeError(w, http.StatusUnauthorized, "agent_unauthorized", "Agent bearer token required")
		return false
	}
	provided := strings.TrimSpace(header[len("Bearer "):])
	if len(provided) != len(expected) || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		writeError(w, http.StatusUnauthorized, "agent_unauthorized", "Agent bearer token invalid")
		return false
	}
	return true
}

func (s *Server) cors(next http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, origin := range s.config.AllowedOrigins {
		allowed[origin] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && allowed[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-CS-Timestamp, X-CS-Signature")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Max-Age", "600")
		}
		if r.Method == http.MethodOptions {
			if origin == "" || !allowed[origin] {
				http.Error(w, "CORS origin is not allowed", http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
func (s *Server) requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		s.logger.Info("http request", "method", r.Method, "path", r.URL.Path, "duration", time.Since(start).String())
	})
}
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": code, "message": message})
}
func newID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(value[:]), nil
}
