package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ABHILASH9519/cloudsentinels/internal/config"
	"github.com/ABHILASH9519/cloudsentinels/internal/domain"
)

// createIncidentForTest creates one incident through the public route and
// returns its generated identifier.
func createIncidentForTest(t *testing.T, server *Server) string {
	t.Helper()
	body := `{"title":"Pod crash loop","description":"payments-api is restarting","severity":"high","source":"prometheus"}`
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/incidents", strings.NewReader(body)))
	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201 create, got %d: %s", response.Code, response.Body.String())
	}
	var item map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	id, ok := item["id"].(string)
	if !ok || id == "" {
		t.Fatalf("expected generated incident id, got %#v", item["id"])
	}
	return id
}

func TestIncidentCreateDefaultsTargetAndStampsTimestamps(t *testing.T) {
	server := newTestServer()
	body := `{"title":"Node NotReady","severity":"critical","source":"kubernetes"}`
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/incidents", strings.NewReader(body)))
	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
	}
	var item map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	if item["target"] != "online-server" {
		t.Fatalf("expected default online-server target, got %#v", item["target"])
	}
	for _, field := range []string{"createdAt", "updatedAt"} {
		value, ok := item[field].(string)
		if !ok || value == "" {
			t.Fatalf("expected %s to be a timestamp string, got %#v", field, item[field])
		}
		parsed, err := time.Parse(time.RFC3339Nano, value)
		if err != nil || parsed.IsZero() {
			t.Fatalf("expected %s to be a valid nonzero RFC3339 timestamp, got %q (err=%v)", field, value, err)
		}
	}
	if item["status"] != "open" {
		t.Fatalf("expected default open status, got %#v", item["status"])
	}
}

func TestIncidentDefaultsTargetFromExecutionMode(t *testing.T) {
	for _, test := range []struct {
		mode string
		want string
	}{
		{mode: "online-server", want: "online-server"},
		{mode: "online-serverless", want: "online-serverless"},
		{mode: "offline-kubernetes", want: "offline-kubernetes"},
	} {
		t.Run(test.mode, func(t *testing.T) {
			server := NewServer(config.Config{ExecutionMode: test.mode}, slog.Default(), testAuthenticator{})
			body := `{"title":"Mode target test","severity":"low","source":"test"}`
			response := httptest.NewRecorder()
			server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/incidents", strings.NewReader(body)))
			if response.Code != http.StatusCreated {
				t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
			}
			var item map[string]any
			if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil {
				t.Fatal(err)
			}
			if item["target"] != test.want {
				t.Fatalf("expected target %q, got %#v", test.want, item["target"])
			}
		})
	}
}

func TestIncidentCreateKeepsRawLogOutOfDescription(t *testing.T) {
	server := newTestServer()
	secret := "authorization=do-not-forward-this"
	body, err := json.Marshal(map[string]string{
		"title": "Raw log incident", "severity": "high", "source": "test", "rawLog": secret,
	})
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/incidents", strings.NewReader(string(body))))
	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
	}
	var item map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	if item["rawLog"] != secret {
		t.Fatalf("expected raw log to remain attached to incident")
	}
	if strings.Contains(item["description"].(string), secret) {
		t.Fatalf("raw log leaked into description: %#v", item["description"])
	}
}

func TestIncidentCommentRejectsClientSuppliedAuthor(t *testing.T) {
	server := newTestServer()
	id := createIncidentForTest(t, server)
	response := httptest.NewRecorder()
	body := `{"author":"admin@example.com","text":"spoof attempt"}`
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/incidents/"+id+"/comments", strings.NewReader(body)))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for client-supplied author, got %d: %s", response.Code, response.Body.String())
	}
}

func TestSafeIncidentSummaryAlwaysUsesFixedWebhookText(t *testing.T) {
	descriptions := []string{
		"Payments API failed after deployment",
		"token=plain-secret",
		"SLACK_TOKEN=xoxb-secret-value",
		"connect https://operator:password@internal.example",
		"-----BEGIN PRIVATE KEY-----\\nprivate-key-material\\n-----END PRIVATE KEY-----",
	}
	for _, description := range descriptions {
		item := domain.Incident{Description: description, RawLog: "password=raw-log-secret"}
		summary := safeIncidentSummary(item)
		if summary != "A new incident was created. Open CloudSentinels to inspect its details." {
			t.Fatalf("expected fixed generic webhook summary for %q, got %q", description, summary)
		}
		if strings.Contains(summary, "secret") || strings.Contains(summary, "private-key-material") {
			t.Fatalf("sensitive material leaked into webhook summary: %q", summary)
		}
	}
}

func TestSafeIncidentSummaryFallsBackForPrefixedCredentialsAndBasicAuth(t *testing.T) {
	item := domain.Incident{
		Description: "DB_PASSWORD=hunter2; Authorization: Basic c2VjcmV0",
	}
	summary := safeIncidentSummary(item)
	if strings.Contains(summary, "hunter2") || strings.Contains(summary, "c2VjcmV0") {
		t.Fatalf("credential material leaked into webhook summary: %q", summary)
	}
	if !strings.Contains(summary, "Open CloudSentinels") {
		t.Fatalf("expected generic fallback for credential-like description, got %q", summary)
	}
}

func TestSafeIncidentSummaryUsesGenericTextForRawLogFallback(t *testing.T) {
	item := domain.Incident{
		Description: "Raw log attached. Review it in the incident details.",
		RawLog:      "password=do-not-forward-this",
	}
	summary := safeIncidentSummary(item)
	if strings.Contains(summary, "do-not-forward-this") || strings.Contains(summary, "password") {
		t.Fatalf("raw log leaked into webhook summary: %q", summary)
	}
	if !strings.Contains(summary, "Open CloudSentinels") {
		t.Fatalf("expected safe generic summary, got %q", summary)
	}
}

func TestTriagePrioritizesSpecificSignalsAndNumericBoundaries(t *testing.T) {
	pending := domain.Incident{Title: "Deployment pending; request took 5000ms", Severity: domain.SeverityHigh, Status: domain.StatusOpen}
	_, cause, _ := triageIncident(pending)
	if !strings.Contains(cause, "cannot be scheduled") {
		t.Fatalf("expected pending scheduler signal to outrank generic deployment, got %q", cause)
	}

	oom := domain.Incident{Title: "OOMKilled in deployment checkout", Severity: domain.SeverityHigh, Status: domain.StatusOpen}
	_, cause, _ = triageIncident(oom)
	if !strings.Contains(cause, "OOM-killed") {
		t.Fatalf("expected OOMKilled to outrank deployment rollout, got %q", cause)
	}

	evicted := domain.Incident{Title: "Pod evicted from deployment api", Severity: domain.SeverityHigh, Status: domain.StatusOpen}
	_, cause, _ = triageIncident(evicted)
	if !strings.Contains(cause, "evicted because the node") {
		t.Fatalf("expected eviction to outrank deployment rollout, got %q", cause)
	}

	genericDeployment := domain.Incident{Title: "Deployment rollout unavailable", Severity: domain.SeverityHigh, Status: domain.StatusOpen}
	_, cause, _ = triageIncident(genericDeployment)
	if !strings.Contains(cause, "deployment rollout") {
		t.Fatalf("expected generic deployment signal when no specific cause exists, got %q", cause)
	}

	falsePositive := domain.Incident{Title: "Request duration was 5000ms", Severity: domain.SeverityHigh, Status: domain.StatusOpen}
	_, cause, _ = triageIncident(falsePositive)
	if !strings.Contains(cause, "No single rule matched") {
		t.Fatalf("HTTP 500 rule must not match 5000ms, got %q", cause)
	}

	compoundCPU := domain.Incident{Title: "KubernetesContainerHighCPU", Severity: domain.SeverityHigh, Status: domain.StatusOpen}
	_, cause, _ = triageIncident(compoundCPU)
	if !strings.Contains(cause, "CPU utilisation is high") {
		t.Fatalf("expected compound CPU alert to match CPU triage, got %q", cause)
	}

	httpError := domain.Incident{Title: "Upstream returned HTTP 500", Severity: domain.SeverityHigh, Status: domain.StatusOpen}
	_, cause, _ = triageIncident(httpError)
	if !strings.Contains(cause, "Elevated latency or error rates") {
		t.Fatalf("expected exact HTTP 500 to match the error-rate rule, got %q", cause)
	}
}

func TestIncidentGetReturnsCreatedIncident(t *testing.T) {
	server := newTestServer()
	id := createIncidentForTest(t, server)

	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/incidents/"+id, nil))
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var item map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	if item["id"] != id || item["title"] != "Pod crash loop" {
		t.Fatalf("unexpected incident payload: %#v", item)
	}
}

func TestIncidentGetUnknownReturns404(t *testing.T) {
	server := newTestServer()
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/incidents/does-not-exist", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", response.Code)
	}
}

func TestIncidentPatchUpdatesStatusAndRejectsInvalidStatus(t *testing.T) {
	server := newTestServer()
	id := createIncidentForTest(t, server)

	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPatch, "/api/v1/incidents/"+id, strings.NewReader(`{"status":"resolved"}`)))
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 patch, got %d: %s", response.Code, response.Body.String())
	}
	var item map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	if item["status"] != "resolved" {
		t.Fatalf("expected resolved status, got %#v", item["status"])
	}

	invalid := httptest.NewRecorder()
	server.Handler().ServeHTTP(invalid, httptest.NewRequest(http.MethodPatch, "/api/v1/incidents/"+id, strings.NewReader(`{"status":"magic"}`)))
	if invalid.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for invalid status, got %d", invalid.Code)
	}
}

func TestIncidentPatchRejectsUnknownFields(t *testing.T) {
	server := newTestServer()
	id := createIncidentForTest(t, server)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPatch, "/api/v1/incidents/"+id, strings.NewReader(`{"unexpected":"value"}`)))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unknown field, got %d", response.Code)
	}
}

func TestIncidentDeleteRemovesIncident(t *testing.T) {
	server := newTestServer()
	id := createIncidentForTest(t, server)

	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodDelete, "/api/v1/incidents/"+id, nil))
	if response.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", response.Code, response.Body.String())
	}

	missing := httptest.NewRecorder()
	server.Handler().ServeHTTP(missing, httptest.NewRequest(http.MethodGet, "/api/v1/incidents/"+id, nil))
	if missing.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after delete, got %d", missing.Code)
	}
}

func TestIncidentAnalyzePersistsExplainableTriage(t *testing.T) {
	server := newTestServer()
	id := createIncidentForTest(t, server)

	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/incidents/"+id+"/analyze", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 analyze, got %d: %s", response.Code, response.Body.String())
	}
	var item map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	summary, _ := item["aiSummary"].(string)
	rootCause, _ := item["rootCause"].(string)
	suggestedFix, _ := item["suggestedFix"].(string)
	if summary == "" || rootCause == "" || suggestedFix == "" {
		t.Fatalf("expected triage fields to be populated, got %#v", item)
	}
	// The documented architecture is an explainable rules engine, not an LLM.
	if !strings.Contains(summary, "rule-engine") || !strings.Contains(summary, "not a trained ML/LLM") {
		t.Fatalf("triage summary must disclose it is a rules engine, got %q", summary)
	}
}

func TestIncidentCommentsRoundTrip(t *testing.T) {
	server := newTestServer()
	id := createIncidentForTest(t, server)

	created := httptest.NewRecorder()
	server.Handler().ServeHTTP(created, httptest.NewRequest(http.MethodPost, "/api/v1/incidents/"+id+"/comments", strings.NewReader(`{"text":"Investigated the restart loop."}`)))
	if created.Code != http.StatusCreated {
		t.Fatalf("expected 201 comment, got %d: %s", created.Code, created.Body.String())
	}

	listed := httptest.NewRecorder()
	server.Handler().ServeHTTP(listed, httptest.NewRequest(http.MethodGet, "/api/v1/incidents/"+id+"/comments", nil))
	if listed.Code != http.StatusOK {
		t.Fatalf("expected 200 list, got %d", listed.Code)
	}
	var payload struct {
		Items []map[string]any `json:"items"`
		Count int              `json:"count"`
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Count != 1 || len(payload.Items) != 1 {
		t.Fatalf("expected exactly one comment, got %#v", payload)
	}
	if payload.Items[0]["author"] != "test-user" || payload.Items[0]["incidentId"] != id {
		t.Fatalf("unexpected comment payload: %#v", payload.Items[0])
	}
}

func TestIncidentCommentRejectsEmptyText(t *testing.T) {
	server := newTestServer()
	id := createIncidentForTest(t, server)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/incidents/"+id+"/comments", strings.NewReader(`{"text":"   "}`)))
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for empty comment, got %d", response.Code)
	}
}

func TestIncidentCommentOnUnknownIncidentReturns404(t *testing.T) {
	server := newTestServer()
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/incidents/missing/comments", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", response.Code)
	}
}

func TestIncidentLifecycleRoutesFailClosedWithoutAuthenticator(t *testing.T) {
	server := NewServer(config.Config{ExecutionMode: "online-server"}, slog.Default(), nil)
	routes := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/incidents/abc"},
		{http.MethodPatch, "/api/v1/incidents/abc"},
		{http.MethodDelete, "/api/v1/incidents/abc"},
		{http.MethodPost, "/api/v1/incidents/abc/analyze"},
		{http.MethodGet, "/api/v1/incidents/abc/comments"},
		{http.MethodPost, "/api/v1/incidents/abc/comments"},
	}
	for _, route := range routes {
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, httptest.NewRequest(route.method, route.path, nil))
		if response.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s %s: expected fail-closed 503, got %d", route.method, route.path, response.Code)
		}
	}
}

func TestCORSAllowsIncidentLifecycleMethods(t *testing.T) {
	server := NewServer(config.Config{AllowedOrigins: []string{"http://localhost:5173"}}, slog.Default(), nil)
	for _, method := range []string{http.MethodPatch, http.MethodDelete} {
		request := httptest.NewRequest(http.MethodOptions, "/api/v1/incidents/test", nil)
		request.Header.Set("Origin", "http://localhost:5173")
		request.Header.Set("Access-Control-Request-Method", method)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusNoContent {
			t.Fatalf("expected 204 preflight for %s, got %d", method, response.Code)
		}
		if !strings.Contains(response.Header().Get("Access-Control-Allow-Methods"), method) {
			t.Fatalf("CORS methods do not include %s: %q", method, response.Header().Get("Access-Control-Allow-Methods"))
		}
	}
}
