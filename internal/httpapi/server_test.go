package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ABHILASH9519/cloudsentinels/internal/auth"
	"github.com/ABHILASH9519/cloudsentinels/internal/config"
)

func TestHealthAndPlatformAreAvailableWithoutCredentials(t *testing.T) {
	server := NewServer(config.Config{ExecutionMode: "offline-kubernetes", BuildVersion: "test"}, slog.New(slog.NewTextHandler(discardWriter{}, nil)), nil)
	for _, path := range []string{"/healthz", "/readyz", "/api/v1/platform"} {
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK {
			t.Fatalf("%s: expected 200, got %d", path, response.Code)
		}
	}
}

func TestOnlineServerReadinessFailsClosedWithoutRequiredIntegrations(t *testing.T) {
	server := NewServer(config.Config{ExecutionMode: "online-server"}, slog.Default(), nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 while auth, n8n and agent credentials are missing, got %d", response.Code)
	}
	var payload struct {
		Status  string   `json:"status"`
		Missing []string `json:"missing"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Status != "not_ready" || len(payload.Missing) != 3 {
		t.Fatalf("unexpected readiness payload: %#v", payload)
	}
}

func TestOnlineServerReadinessPassesWhenRequiredIntegrationsAreConfigured(t *testing.T) {
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusAccepted) }))
	defer hook.Close()
	cfg := config.Config{ExecutionMode: "online-server", AgentToken: strings.Repeat("a", 48), N8NWebhookURL: hook.URL, N8NSigningSecret: strings.Repeat("b", 48)}
	server := NewServer(cfg, slog.Default(), testAuthenticator{})
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
}
func TestIncidentRoutesFailClosedWithoutAuthenticator(t *testing.T) {
	server := NewServer(config.Config{ExecutionMode: "online-server"}, slog.Default(), nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/incidents", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected fail-closed 503, got %d", response.Code)
	}
	var payload map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["error"] != "authentication_unconfigured" {
		t.Fatalf("unexpected error payload: %#v", payload)
	}
}

type discardWriter struct{}

func (discardWriter) Write(p []byte) (int, error) { return len(p), nil }

type testAuthenticator struct{}

func (testAuthenticator) Authenticate(*http.Request) (auth.Principal, error) {
	return auth.Principal{Subject: "test-user", Roles: []string{"operator"}}, nil
}

type viewerAuthenticator struct{}

func (viewerAuthenticator) Authenticate(*http.Request) (auth.Principal, error) {
	return auth.Principal{Subject: "viewer-user", Roles: []string{"viewer"}}, nil
}

func TestIncidentMutationsRequireOperatorRole(t *testing.T) {
	server := newTestServer()
	ids := []string{createIncidentForTest(t, server), createIncidentForTest(t, server), createIncidentForTest(t, server), createIncidentForTest(t, server)}
	server.authenticator = viewerAuthenticator{}
	requests := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodPatch, "/api/v1/incidents/" + ids[0], `{"status":"resolved"}`},
		{http.MethodDelete, "/api/v1/incidents/" + ids[1], ""},
		{http.MethodPost, "/api/v1/incidents/" + ids[2] + "/analyze", ""},
		{http.MethodPost, "/api/v1/incidents/" + ids[3] + "/comments", `{"text":"viewer comment"}`},
	}
	for _, test := range requests {
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, httptest.NewRequest(test.method, test.path, strings.NewReader(test.body)))
		if response.Code != http.StatusForbidden {
			t.Errorf("%s %s: expected 403, got %d: %s", test.method, test.path, response.Code, response.Body.String())
		}
	}
}

func newTestServer() *Server {
	return NewServer(config.Config{ExecutionMode: "online-server"}, slog.Default(), testAuthenticator{})
}

func TestAuthenticatedIncidentCreation(t *testing.T) {
	server := newTestServer()
	body := `{"title":"Pod crash loop","description":"payments-api is restarting","severity":"high","source":"prometheus","target":"offline-kubernetes"}`
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/incidents", strings.NewReader(body))
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"status":"open"`) {
		t.Fatalf("expected default open status, got %s", response.Body.String())
	}
	var incident map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &incident); err != nil {
		t.Fatal(err)
	}
	if id, ok := incident["id"].(string); !ok || len(id) != 32 {
		t.Fatalf("expected a 128-bit random hex ID, got %#v", incident["id"])
	}
}

func TestIncidentCreationRejectsTrailingJSON(t *testing.T) {
	server := newTestServer()
	body := `{"title":"Pod crash loop","severity":"high","source":"prometheus","target":"offline-kubernetes"} {}`
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/incidents", strings.NewReader(body)))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for trailing JSON, got %d", response.Code)
	}
}

func TestIncidentCreationRejectsInvalidStatus(t *testing.T) {
	server := newTestServer()
	body := `{"title":"Pod crash loop","severity":"high","status":"magic","source":"prometheus","target":"offline-kubernetes"}`
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/incidents", strings.NewReader(body)))
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for invalid status, got %d", response.Code)
	}
}

func TestIncidentCreationRejectsDuplicateID(t *testing.T) {
	server := newTestServer()
	body := `{"id":"fixed-id","title":"Pod crash loop","severity":"high","source":"prometheus","target":"offline-kubernetes"}`
	for attempt := 0; attempt < 2; attempt++ {
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/incidents", strings.NewReader(body)))
		expected := http.StatusCreated
		if attempt == 1 {
			expected = http.StatusConflict
		}
		if response.Code != expected {
			t.Fatalf("attempt %d: expected %d, got %d", attempt, expected, response.Code)
		}
	}
}

func TestApprovedRemediationQueuesOnlyRegisteredClusterAndAllowedNamespace(t *testing.T) {
	cfg := config.Config{
		ExecutionMode:                "online-server",
		AllowLocalMutations:          true,
		RemediationAllowedNamespaces: []string{"cloudsentinels-benchmark"},
	}
	server := NewServer(cfg, slog.Default(), testAuthenticator{})
	server.localTelemetry["cloudsentinels-local"] = LocalTelemetry{ClusterID: "cloudsentinels-local"}
	body := `{"action":"restart-deployment","clusterId":"cloudsentinels-local","namespace":"cloudsentinels-benchmark","deployment":"benchmark-api","confirm":true}`
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/remediation/commands", strings.NewReader(body)))
	if response.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", response.Code, response.Body.String())
	}
	var command map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &command); err != nil {
		t.Fatal(err)
	}
	if command["approvalStatus"] != "approved" || command["approvedBy"] != "test-user" || command["status"] != "queued" {
		t.Fatalf("unexpected approval record: %#v", command)
	}
	if len(server.automationQueue.List()) != 1 {
		t.Fatalf("expected one queued command, got %d", len(server.automationQueue.List()))
	}
}

func TestRemediationRequiresExplicitConfirmation(t *testing.T) {
	cfg := config.Config{
		ExecutionMode:                "online-server",
		AllowLocalMutations:          true,
		RemediationAllowedNamespaces: []string{"cloudsentinels-benchmark"},
	}
	server := NewServer(cfg, slog.Default(), testAuthenticator{})
	server.localTelemetry["cloudsentinels-local"] = LocalTelemetry{ClusterID: "cloudsentinels-local"}
	body := `{"action":"restart-deployment","clusterId":"cloudsentinels-local","namespace":"cloudsentinels-benchmark","deployment":"benchmark-api","confirm":false}`
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/remediation/commands", strings.NewReader(body)))
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", response.Code)
	}
	if len(server.automationQueue.List()) != 0 {
		t.Fatal("unconfirmed remediation must not enter the command queue")
	}
}

func TestRemediationRejectsUnregisteredClusterAndUnapprovedNamespace(t *testing.T) {
	cfg := config.Config{
		ExecutionMode:                "online-server",
		AllowLocalMutations:          true,
		RemediationAllowedNamespaces: []string{"cloudsentinels-benchmark"},
	}
	server := NewServer(cfg, slog.Default(), testAuthenticator{})
	body := `{"action":"restart-deployment","clusterId":"unknown-cluster","namespace":"cloudsentinels-benchmark","deployment":"benchmark-api","confirm":true}`
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/remediation/commands", strings.NewReader(body)))
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for unregistered cluster, got %d", response.Code)
	}
	server.localTelemetry["cloudsentinels-local"] = LocalTelemetry{ClusterID: "cloudsentinels-local"}
	body = `{"action":"restart-deployment","clusterId":"cloudsentinels-local","namespace":"default","deployment":"benchmark-api","confirm":true}`
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/remediation/commands", strings.NewReader(body)))
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for unapproved namespace, got %d", response.Code)
	}
	if len(server.automationQueue.List()) != 0 {
		t.Fatal("rejected remediation must not enter the command queue")
	}
}
