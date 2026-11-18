package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
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
	SourceType      string    `json:"sourceType,omitempty"`
	Environment     string    `json:"environment,omitempty"`
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

type AgentEvent struct {
	ClusterID    string    `json:"clusterId"`
	ClusterName  string    `json:"clusterName"`
	EventID      string    `json:"eventId"`
	EventType    string    `json:"eventType"`
	Severity     string    `json:"severity"`
	Title        string    `json:"title"`
	Summary      string    `json:"summary"`
	ResourceID   string    `json:"resourceId,omitempty"`
	ResourceKind string    `json:"resourceKind,omitempty"`
	ResourceName string    `json:"resourceName,omitempty"`
	Namespace    string    `json:"namespace,omitempty"`
	OccurredAt   time.Time `json:"occurredAt,omitempty"`
}

type Server struct {
	config              config.Config
	logger              *slog.Logger
	authenticator       Authenticator
	inventory           *inventory.Store
	automationQueue     *automation.Queue
	zapier              *automation.Dispatcher
	n8n                 *automation.Dispatcher
	incidentsMu         sync.RWMutex
	incidents           map[string]domain.Incident
	commentsMu          sync.RWMutex
	comments            map[string][]domain.IncidentComment
	telemetryMu         sync.RWMutex
	localTelemetry      map[string]LocalTelemetry
	automationMu        sync.Mutex
	lastAutomationEvent map[string]time.Time
	automationInFlight  map[string]struct{}
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
		n8n:       newN8NDispatcher(cfg),
		incidents: make(map[string]domain.Incident), comments: make(map[string][]domain.IncidentComment),
		localTelemetry:      make(map[string]LocalTelemetry),
		lastAutomationEvent: make(map[string]time.Time), automationInFlight: make(map[string]struct{}),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /readyz", s.ready)
	mux.HandleFunc("GET /api/v1/platform", s.platform)
	mux.HandleFunc("GET /api/v1/auth/me", s.currentUser)
	mux.HandleFunc("GET /api/v1/incidents", s.listIncidents)
	mux.HandleFunc("POST /api/v1/incidents", s.createIncident)
	mux.HandleFunc("GET /api/v1/incidents/{id}", s.getIncident)
	mux.HandleFunc("PATCH /api/v1/incidents/{id}", s.updateIncident)
	mux.HandleFunc("DELETE /api/v1/incidents/{id}", s.deleteIncident)
	mux.HandleFunc("POST /api/v1/incidents/{id}/analyze", s.analyzeIncident)
	mux.HandleFunc("GET /api/v1/incidents/{id}/comments", s.listIncidentComments)
	mux.HandleFunc("POST /api/v1/incidents/{id}/comments", s.addIncidentComment)
	mux.HandleFunc("GET /api/v1/inventory/clusters", s.listClusters)
	mux.HandleFunc("POST /api/v1/inventory/refresh", s.refreshInventory)
	mux.HandleFunc("GET /api/v1/monitoring/summary", s.monitoringSummary)
	mux.HandleFunc("GET /api/v1/ai/insights", s.aiInsights)
	mux.HandleFunc("POST /api/v1/ai/analyze", s.runAIAnalysis)
	mux.HandleFunc("POST /api/v1/zapier/commands", s.zapierCommand)
	mux.HandleFunc("POST /api/v1/zapier/test", s.testZapier)
	mux.HandleFunc("POST /api/v1/n8n/test", s.testN8N)
	mux.HandleFunc("GET /api/v1/automation/commands", s.listAutomationCommands)
	mux.HandleFunc("POST /api/v1/remediation/preview", s.previewRemediation)
	mux.HandleFunc("POST /api/v1/remediation/commands", s.queueRemediation)
	mux.HandleFunc("GET /api/v1/agent/commands", s.agentCommands)
	mux.HandleFunc("POST /api/v1/agent/commands/{id}/result", s.agentCommandResult)
	mux.HandleFunc("POST /api/v1/agent/telemetry", s.agentTelemetry)
	mux.HandleFunc("POST /api/v1/agent/events", s.agentEvent)
	mux.HandleFunc("GET /api/v1/agent/telemetry", s.getAgentTelemetry)
	return s.requestLogger(securityHeaders(s.cors(mux)))
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "cloudsentinels"})
}
func (s *Server) ready(w http.ResponseWriter, _ *http.Request) {
	missing := make([]string, 0, 3)
	if s.config.ExecutionMode != "offline-kubernetes" && s.authenticator == nil {
		missing = append(missing, "firebase-authentication")
	}
	if s.config.ExecutionMode == "online-server" {
		if s.n8n == nil || !s.n8n.Enabled() {
			missing = append(missing, "local-n8n-webhook")
		}
		if s.config.AgentToken == "" && len(s.config.AgentTokens) == 0 {
			missing = append(missing, "kubernetes-agent-authentication")
		}
	}
	if len(missing) > 0 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"status": "not_ready", "executionMode": s.config.ExecutionMode, "missing": missing,
		})
		return
	}
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
	n8nStatus := "not-configured"
	if s.n8n != nil && s.n8n.Enabled() {
		n8nStatus = "configured"
	}
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
		"integrations": map[string]string{"airtable": airtableStatus, "zapier": zapierStatus, "n8n": n8nStatus, "desktopAgent": localStatus},
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
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "count": len(items), "storage": "process-memory"})
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
	now := time.Now().UTC()
	if item.CreatedAt.IsZero() {
		item.CreatedAt = now
	}
	item.UpdatedAt = now
	if strings.TrimSpace(item.Description) == "" && strings.TrimSpace(item.RawLog) != "" {
		item.Description = "Raw log attached. Review it in the incident details."
	}
	if strings.TrimSpace(string(item.Target)) == "" {
		switch s.config.ExecutionMode {
		case "offline-kubernetes":
			item.Target = domain.TargetOfflineKubernetes
		case "online-serverless":
			item.Target = domain.TargetOnlineServerless
		default:
			item.Target = domain.TargetOnlineServer
		}
	}
	if err := item.Validate(); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_incident", err.Error())
		return
	}
	s.incidentsMu.Lock()
	if _, exists := s.incidents[item.ID]; exists {
		s.incidentsMu.Unlock()
		writeError(w, http.StatusConflict, "incident_exists", "An incident with this identifier already exists")
		return
	}
	s.incidents[item.ID] = item
	s.incidentsMu.Unlock()
	s.emitAutomationEvent("incident:"+item.ID, automation.Event{EventType: "incident.created", EventID: item.ID, SourceType: "cloudsentinels-api", Environment: s.config.Environment, Severity: string(item.Severity), Title: item.Title, Summary: safeIncidentSummary(item)}, 0)
	writeJSON(w, http.StatusCreated, item)
}

var (
	credentialAssignmentPattern = regexp.MustCompile(`(?i)\b(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|client[_-]?secret)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)`)
	bearerTokenPattern          = regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+`)
	awsAccessKeyPattern         = regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`)
	jwtPattern                  = regexp.MustCompile(`\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b`)
	githubTokenPattern          = regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9_]{20,}\b`)
)

// safeIncidentSummary keeps useful operator-authored descriptions for ticket
// sync while excluding raw logs and common credential formats from webhooks.
func safeIncidentSummary(item domain.Incident) string {
	summary := strings.TrimSpace(item.Description)
	if summary == "" || summary == "Raw log attached. Review it in the incident details." {
		return "A new incident was created. Open CloudSentinels to inspect its details."
	}
	summary = bearerTokenPattern.ReplaceAllString(summary, "Bearer [REDACTED]")
	summary = credentialAssignmentPattern.ReplaceAllString(summary, "$1=[REDACTED]")
	summary = awsAccessKeyPattern.ReplaceAllString(summary, "[REDACTED_AWS_ACCESS_KEY]")
	summary = jwtPattern.ReplaceAllString(summary, "[REDACTED_JWT]")
	summary = githubTokenPattern.ReplaceAllString(summary, "[REDACTED_GITHUB_TOKEN]")
	runes := []rune(summary)
	if len(runes) > 1000 {
		summary = string(runes[:1000])
	}
	if strings.TrimSpace(summary) == "" {
		return "A new incident was created. Open CloudSentinels to inspect its details."
	}
	return summary
}

func incidentPathID(r *http.Request) string {
	return strings.TrimSpace(r.PathValue("id"))
}

func (s *Server) lookupIncident(id string) (domain.Incident, bool) {
	s.incidentsMu.RLock()
	defer s.incidentsMu.RUnlock()
	item, ok := s.incidents[id]
	return item, ok
}

func (s *Server) getIncident(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	id := incidentPathID(r)
	item, ok := s.lookupIncident(id)
	if !ok {
		writeError(w, http.StatusNotFound, "incident_not_found", "No incident exists for this identifier")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

// updateIncident applies a validated partial update. Only supplied fields change.
func (s *Server) updateIncident(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		return
	}
	id := incidentPathID(r)
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	var patch struct {
		Title         *string `json:"title"`
		Description   *string `json:"description"`
		Severity      *string `json:"severity"`
		Status        *string `json:"status"`
		Assignee      *string `json:"assignee"`
		RawLog        *string `json:"rawLog"`
		AISummary     *string `json:"aiSummary"`
		RootCause     *string `json:"rootCause"`
		SuggestedFix  *string `json:"suggestedFix"`
		CorrelationID *string `json:"correlationId"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&patch); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body is not valid incident patch JSON")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body must contain exactly one JSON object")
		return
	}
	s.incidentsMu.Lock()
	item, ok := s.incidents[id]
	if !ok {
		s.incidentsMu.Unlock()
		writeError(w, http.StatusNotFound, "incident_not_found", "No incident exists for this identifier")
		return
	}
	previousStatus := item.Status
	if patch.Title != nil {
		item.Title = strings.TrimSpace(*patch.Title)
	}
	if patch.Description != nil {
		item.Description = *patch.Description
	}
	if patch.Severity != nil {
		item.Severity = domain.Severity(strings.ToLower(strings.TrimSpace(*patch.Severity)))
	}
	if patch.Status != nil {
		item.Status = domain.IncidentStatus(strings.ToLower(strings.TrimSpace(*patch.Status)))
	}
	if patch.Assignee != nil {
		item.Assignee = strings.TrimSpace(*patch.Assignee)
	}
	if patch.RawLog != nil {
		item.RawLog = *patch.RawLog
	}
	if patch.AISummary != nil {
		item.AISummary = *patch.AISummary
	}
	if patch.RootCause != nil {
		item.RootCause = *patch.RootCause
	}
	if patch.SuggestedFix != nil {
		item.SuggestedFix = *patch.SuggestedFix
	}
	if patch.CorrelationID != nil {
		item.CorrelationID = strings.TrimSpace(*patch.CorrelationID)
	}
	if err := item.Validate(); err != nil {
		s.incidentsMu.Unlock()
		writeError(w, http.StatusUnprocessableEntity, "invalid_incident", err.Error())
		return
	}
	item.UpdatedAt = time.Now().UTC()
	s.incidents[id] = item
	s.incidentsMu.Unlock()
	if item.Status != previousStatus {
		s.emitAutomationEvent("incident-status:"+item.ID, automation.Event{
			EventType: "incident.status_changed", EventID: item.ID, SourceType: "cloudsentinels-api",
			Environment: s.config.Environment, Severity: string(item.Severity), Title: item.Title,
			Summary: fmt.Sprintf("Incident status changed from %s to %s.", previousStatus, item.Status),
		}, 0)
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) deleteIncident(w http.ResponseWriter, r *http.Request) {
	principal, authorized := s.authorizeOperatorPrincipal(w, r)
	if !authorized {
		return
	}
	id := incidentPathID(r)
	s.incidentsMu.Lock()
	if _, ok := s.incidents[id]; !ok {
		s.incidentsMu.Unlock()
		writeError(w, http.StatusNotFound, "incident_not_found", "No incident exists for this identifier")
		return
	}
	delete(s.incidents, id)
	s.commentsMu.Lock()
	delete(s.comments, id)
	s.commentsMu.Unlock()
	s.incidentsMu.Unlock()
	s.logger.Info("incident deleted", "incident_id", id, "actor_subject", principal.Subject)
	w.WriteHeader(http.StatusNoContent)
}

// analyzeIncident runs the explainable deterministic triage rules against one
// incident and persists the resulting summary, root cause and suggested fix.
// It intentionally does not call an external model: the documented architecture
// is an explainable rules engine, not a trained ML/LLM analyzer.
func (s *Server) analyzeIncident(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		return
	}
	id := incidentPathID(r)
	s.incidentsMu.Lock()
	item, ok := s.incidents[id]
	if !ok {
		s.incidentsMu.Unlock()
		writeError(w, http.StatusNotFound, "incident_not_found", "No incident exists for this identifier")
		return
	}
	summary, rootCause, suggestedFix := triageIncident(item)
	item.AISummary = summary
	item.RootCause = rootCause
	item.SuggestedFix = suggestedFix
	item.UpdatedAt = time.Now().UTC()
	if err := item.Validate(); err != nil {
		s.incidentsMu.Unlock()
		writeError(w, http.StatusUnprocessableEntity, "invalid_incident", err.Error())
		return
	}
	s.incidents[id] = item
	s.incidentsMu.Unlock()
	s.emitAutomationEvent("incident-analysis:"+item.ID, automation.Event{
		EventType: "incident.analyzed", EventID: item.ID, SourceType: "cloudsentinels-api",
		Environment: s.config.Environment, Severity: string(item.Severity), Title: item.Title,
		Summary: "Explainable rule-engine triage produced a summary, likely cause and safe next steps.",
	}, 10*time.Minute)
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) listIncidentComments(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	id := incidentPathID(r)
	if _, ok := s.lookupIncident(id); !ok {
		writeError(w, http.StatusNotFound, "incident_not_found", "No incident exists for this identifier")
		return
	}
	s.commentsMu.RLock()
	items := append([]domain.IncidentComment(nil), s.comments[id]...)
	s.commentsMu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "count": len(items)})
}

func (s *Server) addIncidentComment(w http.ResponseWriter, r *http.Request) {
	principal, authorized := s.authorizeOperatorPrincipal(w, r)
	if !authorized {
		return
	}
	id := incidentPathID(r)
	if _, ok := s.lookupIncident(id); !ok {
		writeError(w, http.StatusNotFound, "incident_not_found", "No incident exists for this identifier")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
	var input struct {
		Text string `json:"text"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_comment", "Comment JSON is invalid")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid_comment", "Comment body must contain exactly one JSON object")
		return
	}
	comment := domain.IncidentComment{
		IncidentID: id,
		Author:     firstNonEmpty(principal.Email, principal.Subject),
		Text:       strings.TrimSpace(input.Text),
	}
	if err := comment.Validate(); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_comment", "Comment text is required and must be within length bounds")
		return
	}
	commentID, err := newID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "id_generation_failed", "Could not generate a comment identifier")
		return
	}
	comment.ID = commentID
	comment.CreatedAt = time.Now().UTC()
	s.incidentsMu.Lock()
	if _, ok := s.incidents[id]; !ok {
		s.incidentsMu.Unlock()
		writeError(w, http.StatusNotFound, "incident_not_found", "No incident exists for this identifier")
		return
	}
	s.commentsMu.Lock()
	s.comments[id] = append(s.comments[id], comment)
	s.commentsMu.Unlock()
	s.incidentsMu.Unlock()
	writeJSON(w, http.StatusCreated, comment)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// triageIncident is the deterministic, explainable rules engine used for a
// single incident. It maps observed signals to a likely cause and safe checks.
func triageIncident(item domain.Incident) (summary, rootCause, suggestedFix string) {
	haystack := strings.ToLower(strings.Join([]string{item.Title, item.Description, item.RawLog}, " "))
	type signalRule struct {
		keys   []string
		cause  string
		checks []string
	}
	rules := []signalRule{
		{[]string{"crashloopbackoff", "crash loop", "back-off restarting"}, "The container is repeatedly restarting, most often due to a failing startup command, a failing probe, or a missing configuration/secret.", []string{"Read the previous container logs (kubectl logs --previous)", "Inspect the readiness/liveness probes and startup command", "Confirm required ConfigMaps/Secrets are mounted"}},
		{[]string{"imagepullbackoff", "errimagepull", "image pull"}, "The kubelet cannot pull the container image, usually from a bad image reference or missing registry credentials.", []string{"Verify the image name and tag exist in the registry", "Check imagePullSecrets are attached to the pod/service account", "Confirm the node can reach the registry"}},
		{[]string{"oomkilled", "oom killed", "out of memory"}, "The container exceeded its memory limit and was OOM-killed by the kernel.", []string{"Review memory usage against the configured limit", "Right-size requests/limits or fix the memory leak", "Confirm the node has free memory capacity"}},
		{[]string{"evicted", "node pressure", "disk pressure", "memory pressure"}, "The pod was evicted because the node is under resource pressure.", []string{"Check node conditions for DiskPressure/MemoryPressure", "Free space or add capacity", "Set appropriate resource requests for scheduling"}},
		{[]string{"pending", "unschedulable", "insufficient cpu", "insufficient memory", "no nodes available"}, "The pod cannot be scheduled, typically due to insufficient resources, taints, or unsatisfied affinity/anti-affinity.", []string{"Inspect scheduler events for the reason", "Check node capacity and resource requests", "Review taints, tolerations and affinity rules"}},
		{[]string{"unavailable", "rollout", "deployment", "progressdeadline"}, "The deployment rollout is not reaching the desired available replica count.", []string{"Compare desired vs available replicas", "Check the ReplicaSet and pod events", "Consider pausing or rolling back only with approval"}},
		{[]string{"unhealthy", "readiness", "liveness", "probe failed"}, "A health probe is failing, removing the pod from service or triggering restarts.", []string{"Test the probe endpoint from inside the pod", "Confirm probe path, port and timing thresholds", "Verify downstream dependencies the probe relies on"}},
		{[]string{"timeout", "latency", "503", "502", "500", "error rate"}, "Elevated latency or error rates suggest a saturated dependency or a failing upstream service.", []string{"Correlate errors with dependency health metrics", "Check ingress and service saturation", "Apply an approved mitigation only after review"}},
		{[]string{"cpu", "saturation", "throttling", "throttled"}, "CPU utilisation is high, which can throttle request handling.", []string{"Identify the top CPU consumers", "Compare requests/limits with actual usage", "Scale only through an approved capacity policy"}},
		{[]string{"certificate", "tls", "x509"}, "A TLS/certificate error indicates an expired or untrusted certificate.", []string{"Check certificate expiry and chain", "Confirm the trust store used by the client", "Rotate the certificate through the normal process"}},
	}
	bestKey := ""
	bestRule := -1
	for ruleIndex, rule := range rules {
		for _, key := range rule.keys {
			if signalMatches(haystack, key) && len(key) > len(bestKey) {
				bestKey = key
				bestRule = ruleIndex
			}
		}
	}
	cause := "No single rule matched the supplied signals; treat this as an unexplained incident and gather more evidence."
	checks := make([]string, 0, 3)
	confidence := 0.55
	if bestRule >= 0 {
		cause = rules[bestRule].cause
		checks = append(checks, rules[bestRule].checks...)
		confidence = 0.8
	}
	signal := bestKey
	if signal == "" {
		signal = "none"
	}
	summary = fmt.Sprintf(
		"Explainable rule-engine triage (severity %s, status %s). Matched signal: %s. Confidence %.0f%%. This is deterministic rule output, not a trained ML/LLM diagnosis; verify against live telemetry before acting.",
		item.Severity, item.Status, signal, confidence*100,
	)
	if len(checks) == 0 {
		checks = []string{"Collect recent logs and Kubernetes events", "Confirm current cluster telemetry freshness", "Escalate to an operator if the signal recurs"}
	}
	return summary, cause, strings.Join(checks, " ")
}

// signalMatches uses word boundaries for single-token signals so a rule for
// HTTP 500 does not accidentally match values such as 5000ms or request IDs.
func signalMatches(haystack, key string) bool {
	if strings.ContainsAny(key, " \t") {
		return strings.Contains(haystack, key)
	}
	if key == "cpu" {
		for _, token := range strings.FieldsFunc(haystack, func(char rune) bool {
			return !(char >= 'a' && char <= 'z' || char >= '0' && char <= '9')
		}) {
			if token == key || strings.HasSuffix(token, key) {
				return true
			}
		}
		return false
	}
	pattern := `\b` + regexp.QuoteMeta(key) + `\b`
	matched, _ := regexp.MatchString(pattern, haystack)
	return matched
}

func containsString(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
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
		s.emitAutomationEvent("ai:"+insight.ID, automation.Event{
			EventType: "cluster.ai_finding", EventID: insight.ID, ClusterID: insight.ClusterID,
			SourceType: "cloudsentinels-api", Environment: s.config.Environment,
			Severity: insight.Severity, Title: insight.Title, Summary: insight.Summary,
		}, 10*time.Minute)
	}
	writeJSON(w, http.StatusOK, report)
}

func newN8NDispatcher(cfg config.Config) *automation.Dispatcher {
	if cfg.N8NWebhookURL == "" || cfg.N8NSigningSecret == "" {
		return nil
	}
	return &automation.Dispatcher{URL: cfg.N8NWebhookURL, Secret: cfg.N8NSigningSecret, Client: &http.Client{Timeout: 8 * time.Second}}
}

func (s *Server) emitAutomationEvent(key string, event automation.Event, cooldown time.Duration) {
	if (s.zapier == nil || !s.zapier.Enabled()) && (s.n8n == nil || !s.n8n.Enabled()) {
		return
	}
	go func() {
		for _, delay := range []time.Duration{0, time.Second, 3 * time.Second} {
			if delay > 0 {
				time.Sleep(delay)
			}
			if err := s.dispatchAutomationEvent(key, event, cooldown); err == nil {
				return
			}
		}
	}()
}

func (s *Server) dispatchAutomationEvent(key string, event automation.Event, cooldown time.Duration) error {
	n8nEnabled := s.n8n != nil && s.n8n.Enabled()
	zapierEnabled := s.zapier != nil && s.zapier.Enabled()
	if !n8nEnabled && !zapierEnabled {
		return nil
	}
	now := time.Now().UTC()
	s.automationMu.Lock()
	if previous, ok := s.lastAutomationEvent[key]; ok && cooldown > 0 && now.Sub(previous) < cooldown {
		s.automationMu.Unlock()
		return nil
	}
	if _, inFlight := s.automationInFlight[key]; inFlight {
		s.automationMu.Unlock()
		return errors.New("automation event delivery is already in progress; retry")
	}
	s.automationInFlight[key] = struct{}{}
	s.automationMu.Unlock()

	var deliveryErr error
	if n8nEnabled {
		deliveryErr = s.n8n.Send(event)
	}
	if deliveryErr == nil && zapierEnabled {
		go func() {
			if err := s.zapier.Send(event); err != nil {
				s.logger.Warn("Zapier event delivery failed", "event_type", event.EventType, "error", err)
			}
		}()
	}
	s.automationMu.Lock()
	delete(s.automationInFlight, key)
	if deliveryErr == nil {
		s.lastAutomationEvent[key] = now
	}
	s.automationMu.Unlock()
	if deliveryErr != nil {
		s.logger.Warn("automation event delivery failed", "event_type", event.EventType, "error", deliveryErr)
		return deliveryErr
	}
	return nil
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
	if (input.Action == "restart-deployment" || input.Action == "rollback-deployment") && !s.config.AllowLocalMutations {
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
	s.emitAutomationEvent("command:"+command.ID, automation.Event{EventType: "automation.command_queued", EventID: command.ID, ClusterID: command.ClusterID, SourceType: "cloudsentinels-api", Environment: s.config.Environment, Severity: "info", Title: command.Action, Summary: "A signed automation request was queued for the registered agent."}, 0)
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
	err := s.zapier.Send(automation.Event{EventType: "cloudsentinels.integration_test", SourceType: "cloudsentinels-api", Environment: s.config.Environment, Severity: "info", Title: "CloudSentinels webhook test", Summary: "The outbound Zapier webhook connection is being tested."})
	if err != nil {
		writeError(w, http.StatusBadGateway, "zapier_delivery_failed", "Zapier webhook delivery failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "delivered_to_catch_hook"})
}

func (s *Server) testN8N(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	if s.n8n == nil || !s.n8n.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "n8n_not_configured", "Configure the private local N8N_WEBHOOK_URL and N8N_SIGNING_SECRET")
		return
	}
	if err := s.n8n.Send(automation.Event{EventType: "cloudsentinels.integration_test", SourceType: "cloudsentinels-api", Environment: s.config.Environment, Severity: "info", Title: "CloudSentinels n8n webhook test", Summary: "The outbound local n8n webhook connection is being tested."}); err != nil {
		writeError(w, http.StatusBadGateway, "n8n_delivery_failed", "Local n8n webhook delivery failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "delivered_to_n8n_webhook"})
}

// previewRemediation evaluates an action without queuing or executing it.
func (s *Server) previewRemediation(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
	var input struct {
		Action     string `json:"action"`
		ClusterID  string `json:"clusterId"`
		Namespace  string `json:"namespace"`
		Deployment string `json:"deployment"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_preview", "Preview request JSON is invalid")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid_preview", "Preview body must contain exactly one JSON object")
		return
	}
	if input.Action != "restart-deployment" && input.Action != "rollback-deployment" {
		writeError(w, http.StatusUnprocessableEntity, "action_not_allowed", "Only restart-deployment and rollback-deployment are currently supported")
		return
	}
	probe := automation.Command{Action: input.Action, ClusterID: input.ClusterID, Namespace: input.Namespace, Deployment: input.Deployment, ApprovalStatus: "approved", ApprovedBy: "preview-only"}
	if _, err := automation.NewQueue().Enqueue(probe); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "target_rejected", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "preview_only", "dryRun": true, "queued": false, "executed": false,
		"action": input.Action, "clusterId": input.ClusterID, "namespace": input.Namespace, "deployment": input.Deployment,
		"risk": "high", "requiresHumanApproval": true,
		"serverMutationEnabled": s.config.AllowLocalMutations,
		"executionEnabled":      false,
		"guardrails":            []string{"fixed action allowlist", "cluster-bound agent authentication", "explicit human approval", "server and agent mutation flags must both be enabled", "rollout status verification", "no arbitrary shell commands"},
	})
}

func (s *Server) listAutomationCommands(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": s.automationQueue.List()})
}

func (s *Server) queueRemediation(w http.ResponseWriter, r *http.Request) {
	if s.config.ExecutionMode != "online-server" {
		writeError(w, http.StatusServiceUnavailable, "remediation_unavailable", "Approved local remediation is available only through the persistent online-server control plane")
		return
	}
	if !s.config.AllowLocalMutations {
		writeError(w, http.StatusForbidden, "mutations_disabled", "Local remediation is disabled by server policy")
		return
	}
	if s.authenticator == nil {
		writeError(w, http.StatusServiceUnavailable, "authentication_unconfigured", "Firebase Authentication is required to approve remediation")
		return
	}
	principal, err := s.authenticator.Authenticate(r)
	if err != nil || strings.TrimSpace(principal.Subject) == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "A valid operator identity is required to approve remediation")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var input struct {
		Action     string `json:"action"`
		ClusterID  string `json:"clusterId"`
		Namespace  string `json:"namespace"`
		Deployment string `json:"deployment"`
		Confirm    bool   `json:"confirm"`
	}
	if err := decoder.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_remediation", "Remediation request JSON is invalid")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid_remediation", "Remediation body must contain exactly one JSON object")
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusUnprocessableEntity, "approval_required", "The operator must explicitly confirm this remediation action")
		return
	}
	if input.Action != "restart-deployment" && input.Action != "rollback-deployment" {
		writeError(w, http.StatusUnprocessableEntity, "action_not_allowed", "Only restart-deployment and rollback-deployment are currently supported")
		return
	}
	namespaceAllowed := false
	for _, namespace := range s.config.RemediationAllowedNamespaces {
		if strings.EqualFold(strings.TrimSpace(namespace), strings.TrimSpace(input.Namespace)) {
			namespaceAllowed = true
			break
		}
	}
	if !namespaceAllowed {
		writeError(w, http.StatusUnprocessableEntity, "namespace_not_allowed", "The remediation namespace is not in CLOUDSENTINELS_REMEDIATION_ALLOWED_NAMESPACES")
		return
	}
	s.telemetryMu.RLock()
	_, registeredCluster := s.localTelemetry[input.ClusterID]
	s.telemetryMu.RUnlock()
	if !registeredCluster {
		writeError(w, http.StatusUnprocessableEntity, "cluster_not_registered", "The target cluster has not sent a recent authenticated agent heartbeat")
		return
	}

	command, err := s.automationQueue.Enqueue(automation.Command{
		Action: input.Action, ClusterID: input.ClusterID,
		Namespace: input.Namespace, Deployment: input.Deployment,
		ApprovalStatus: "approved", ApprovedBy: principal.Subject, RequestedBy: principal.Subject,
	})
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "command_rejected", err.Error())
		return
	}
	s.emitAutomationEvent("command:"+command.ID, automation.Event{
		EventType: "automation.command_queued", EventID: command.ID, ClusterID: command.ClusterID,
		SourceType: "cloudsentinels-api", Environment: s.config.Environment, Severity: "info",
		Title: command.Action, Summary: "An operator-approved remediation command was queued for the registered local agent.",
	}, 0)
	writeJSON(w, http.StatusAccepted, command)
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
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	var telemetry LocalTelemetry
	if err := json.NewDecoder(r.Body).Decode(&telemetry); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_telemetry", "Telemetry JSON is invalid")
		return
	}
	if !s.authorizeAgent(w, r, telemetry.ClusterID) {
		return
	}
	telemetry.SourceType = strings.ToLower(strings.TrimSpace(telemetry.SourceType))
	telemetry.Environment = strings.ToLower(strings.TrimSpace(telemetry.Environment))
	if telemetry.ClusterID == "" || len(telemetry.ClusterID) > 128 || telemetry.Context == "" || len(telemetry.Context) > 128 || telemetry.NodeCount < 0 || telemetry.ReadyNodeCount < 0 || telemetry.ReadyNodeCount > telemetry.NodeCount || telemetry.PodCount < 0 || telemetry.HealthyPodCount < 0 || telemetry.HealthyPodCount > telemetry.PodCount || telemetry.WarningEvents < 0 || telemetry.CPUUsagePercent < 0 || telemetry.CPUUsagePercent > 100 || telemetry.MemoryUsageMB < 0 || !validTelemetryLabel(telemetry.SourceType, 64) || !validTelemetryLabel(telemetry.Environment, 32) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_telemetry", "Telemetry fields are outside allowed bounds")
		return
	}
	if telemetry.CollectedAt.IsZero() {
		telemetry.CollectedAt = time.Now().UTC()
	}
	if strings.TrimSpace(telemetry.SourceType) == "" {
		telemetry.SourceType = "kubernetes-agent"
	}
	if strings.TrimSpace(telemetry.Environment) == "" {
		telemetry.Environment = "unknown"
	}
	telemetry.Collector = "cloudsentinels-kubernetes-agent"

	s.telemetryMu.RLock()
	previous, hadPrevious := s.localTelemetry[telemetry.ClusterID]
	s.telemetryMu.RUnlock()
	baseEvent := automation.Event{ClusterID: telemetry.ClusterID, ClusterName: telemetry.Context, SourceType: telemetry.SourceType, Environment: telemetry.Environment}
	if !hadPrevious || time.Since(previous.CollectedAt) > 2*time.Minute {
		online := baseEvent
		online.EventType, online.Severity = "cluster.online", "info"
		online.Title, online.Summary = "Kubernetes cluster connected", "The CloudSentinels agent has reported a fresh, authenticated cluster heartbeat."
		if err := s.dispatchAutomationEvent("online:"+telemetry.ClusterID, online, 2*time.Minute); err != nil {
			writeError(w, http.StatusServiceUnavailable, "automation_delivery_failed", "The unified n8n workflow did not accept the cluster heartbeat; the agent should retry")
			return
		}
		s.automationMu.Lock()
		delete(s.lastAutomationEvent, "offline:"+telemetry.ClusterID)
		s.automationMu.Unlock()
	}
	degraded := telemetry.WarningEvents > 0 || telemetry.ReadyNodeCount < telemetry.NodeCount || telemetry.HealthyPodCount < telemetry.PodCount
	wasDegraded := hadPrevious && (previous.WarningEvents > 0 || previous.ReadyNodeCount < previous.NodeCount || previous.HealthyPodCount < previous.PodCount)
	if degraded {
		health := baseEvent
		health.EventType, health.Severity = "cluster.health.degraded", "high"
		if telemetry.NodeCount > 0 && telemetry.ReadyNodeCount == 0 {
			health.Severity = "critical"
		}
		health.Title, health.Summary = "Kubernetes cluster health degraded", "The latest agent heartbeat reports warning events or unavailable nodes/pods; inspect cluster telemetry."
		if err := s.dispatchAutomationEvent("health:"+telemetry.ClusterID, health, 5*time.Minute); err != nil {
			writeError(w, http.StatusServiceUnavailable, "automation_delivery_failed", "The unified n8n workflow did not accept the degraded-cluster event; the agent should retry")
			return
		}
	} else if wasDegraded {
		recovered := baseEvent
		recovered.EventType, recovered.Severity = "cluster.health.recovered", "info"
		recovered.Title, recovered.Summary = "Kubernetes cluster health recovered", "The latest agent heartbeat reports healthy nodes and pods with no warning events."
		if err := s.dispatchAutomationEvent("health-recovered:"+telemetry.ClusterID, recovered, 0); err != nil {
			writeError(w, http.StatusServiceUnavailable, "automation_delivery_failed", "The unified n8n workflow did not accept the recovery event; the agent should retry")
			return
		}
	}
	s.telemetryMu.Lock()
	s.localTelemetry[telemetry.ClusterID] = telemetry
	s.telemetryMu.Unlock()
	writeJSON(w, http.StatusAccepted, map[string]any{"status": "accepted", "clusterId": telemetry.ClusterID, "collectedAt": telemetry.CollectedAt})
}
func (s *Server) agentEvent(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	var input AgentEvent
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_agent_event", "Agent event JSON is invalid")
		return
	}
	if !s.authorizeAgent(w, r, input.ClusterID) {
		return
	}
	input.EventID = strings.TrimSpace(input.EventID)
	input.EventType = strings.ToLower(strings.TrimSpace(input.EventType))
	input.Severity = strings.ToLower(strings.TrimSpace(input.Severity))
	input.ResourceKind = strings.ToLower(strings.TrimSpace(input.ResourceKind))
	input.ResourceName = strings.ToLower(strings.TrimSpace(input.ResourceName))
	input.Namespace = strings.ToLower(strings.TrimSpace(input.Namespace))
	input.Title = strings.TrimSpace(input.Title)
	input.Summary = strings.TrimSpace(input.Summary)
	if !validTelemetryLabel(input.EventID, 128) || input.EventID == "" || !validTelemetryLabel(input.EventType, 100) || input.EventType == "" || !validTelemetryLabel(input.Severity, 16) || input.Title == "" || len(input.Title) > 180 || len(input.Summary) > 1000 || len(input.ClusterName) > 128 || !validTelemetryLabel(input.ResourceKind, 64) || !validTelemetryLabel(input.ResourceName, 128) || !validTelemetryLabel(input.Namespace, 128) || len(input.ResourceID) > 256 {
		writeError(w, http.StatusUnprocessableEntity, "invalid_agent_event", "Agent event fields are outside allowed bounds")
		return
	}
	switch input.Severity {
	case "critical", "high", "medium", "low", "info", "warning", "degraded":
	default:
		writeError(w, http.StatusUnprocessableEntity, "invalid_agent_event", "Agent event severity is not supported")
		return
	}
	if input.OccurredAt.IsZero() {
		input.OccurredAt = time.Now().UTC()
	}
	event := automation.Event{
		SchemaVersion: "1", EventID: input.EventID, EventType: input.EventType, OccurredAt: input.OccurredAt,
		ClusterID: input.ClusterID, ClusterName: input.ClusterName, SourceType: "kubernetes-agent", Environment: "local",
		Severity: input.Severity, Title: input.Title, Summary: input.Summary,
		ResourceID: input.ResourceID, ResourceKind: input.ResourceKind, ResourceName: input.ResourceName, Namespace: input.Namespace,
	}
	if err := s.dispatchAutomationEvent("agent-event:"+input.ClusterID+":"+input.EventID, event, 5*time.Minute); err != nil {
		writeError(w, http.StatusServiceUnavailable, "automation_delivery_failed", "The unified n8n workflow did not accept the cluster event; the agent should retry")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"status": "accepted", "eventId": input.EventID, "clusterId": input.ClusterID})
}

func (s *Server) getAgentTelemetry(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": s.localTelemetrySnapshot()})
}

func validTelemetryLabel(value string, maxLength int) bool {
	if len(value) > maxLength {
		return false
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '-' || char == '_' || char == '.' {
			continue
		}
		return false
	}
	return true
}

func (s *Server) StartTelemetryMonitor(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = s.localTelemetrySnapshot()
			}
		}
	}()
}

func (s *Server) localTelemetrySnapshot() []LocalTelemetry {
	s.telemetryMu.RLock()
	items := make([]LocalTelemetry, 0, len(s.localTelemetry))
	for _, t := range s.localTelemetry {
		items = append(items, t)
	}
	s.telemetryMu.RUnlock()

	for _, telemetry := range items {
		if telemetry.CollectedAt.IsZero() || time.Since(telemetry.CollectedAt) <= 2*time.Minute {
			continue
		}
		event := automation.Event{
			EventType: "cluster.offline", EventID: "offline-" + telemetry.ClusterID,
			ClusterID: telemetry.ClusterID, ClusterName: telemetry.Context,
			SourceType: telemetry.SourceType, Environment: telemetry.Environment, Severity: "critical",
			Title:   "Kubernetes agent heartbeat lost",
			Summary: "No authenticated cluster telemetry has been received for more than two minutes.",
		}
		s.emitAutomationEvent("offline:"+telemetry.ClusterID, event, 24*time.Hour)
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

func (s *Server) currentUser(w http.ResponseWriter, r *http.Request) {
	if s.authenticator == nil {
		writeError(w, http.StatusServiceUnavailable, "authentication_unconfigured", "Firebase Authentication is not configured")
		return
	}
	principal, err := s.authenticator.Authenticate(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "A valid Firebase ID token is required")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "uid": principal.Subject, "email": principal.Email, "roles": principal.Roles})
}

func (s *Server) authorizePrincipal(w http.ResponseWriter, r *http.Request) (auth.Principal, bool) {
	if s.authenticator == nil {
		writeError(w, http.StatusServiceUnavailable, "authentication_unconfigured", "Protected API routes are disabled until Firebase Authentication or local development authentication is configured")
		return auth.Principal{}, false
	}
	principal, err := s.authenticator.Authenticate(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "A valid authenticated session is required")
		return auth.Principal{}, false
	}
	return principal, true
}

func (s *Server) authorize(w http.ResponseWriter, r *http.Request) bool {
	_, ok := s.authorizePrincipal(w, r)
	return ok
}

// authorizeOperator restricts incident mutations to explicitly provisioned
// operators and administrators. Authentication alone is not an authorization policy.
func (s *Server) authorizeOperatorPrincipal(w http.ResponseWriter, r *http.Request) (auth.Principal, bool) {
	principal, ok := s.authorizePrincipal(w, r)
	if !ok {
		return auth.Principal{}, false
	}
	for _, role := range principal.Roles {
		switch strings.ToLower(strings.TrimSpace(role)) {
		case "operator", "admin":
			return principal, true
		}
	}
	writeError(w, http.StatusForbidden, "forbidden", "An operator or admin role is required for this incident action")
	return auth.Principal{}, false
}

func (s *Server) authorizeOperator(w http.ResponseWriter, r *http.Request) bool {
	_, ok := s.authorizeOperatorPrincipal(w, r)
	return ok
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
