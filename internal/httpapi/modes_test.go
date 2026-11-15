package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ABHILASH9519/cloudsentinels/internal/automation"
	"github.com/ABHILASH9519/cloudsentinels/internal/config"
	"github.com/ABHILASH9519/cloudsentinels/internal/inventory"
)

func TestAIAnalysisTriggerReturnsExplainableReport(t *testing.T) {
	store, err := inventory.NewStore("../../deploy/eks/airtable-inventory.snapshot.json", nil)
	if err != nil {
		t.Fatal(err)
	}
	server := NewServerWithServices(config.Config{ExecutionMode: "online-server"}, nil, testAuthenticator{}, store, nil, nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/ai/analyze", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("expected analysis report, got %d: %s", response.Code, response.Body.String())
	}
	var report struct {
		Engine     string `json:"engine"`
		Disclaimer string `json:"disclaimer"`
		Insights   []any  `json:"insights"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if report.Engine == "" || report.Disclaimer == "" || len(report.Insights) == 0 {
		t.Fatalf("expected explainable findings, got %#v", report)
	}
}

func TestServerlessModeRejectsEphemeralAgentCommandQueue(t *testing.T) {
	server := NewServerWithServices(config.Config{ExecutionMode: "online-serverless", ZapierSigningSecret: "a-test-signing-secret-with-more-than-32-bytes"}, nil, testAuthenticator{}, nil, automation.NewQueue(), nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/zapier/commands", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected serverless command queue to be disabled, got %d", response.Code)
	}
}

func TestCORSAllowsConfiguredFrontendOriginOnly(t *testing.T) {
	server := NewServerWithServices(config.Config{AllowedOrigins: []string{"http://localhost:5173"}}, nil, nil, nil, nil, nil)
	request := httptest.NewRequest(http.MethodOptions, "/api/v1/inventory/clusters", nil)
	request.Header.Set("Origin", "http://localhost:5173")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNoContent || response.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatalf("configured CORS preflight failed: %d", response.Code)
	}

	request = httptest.NewRequest(http.MethodOptions, "/api/v1/inventory/clusters", nil)
	request.Header.Set("Origin", "https://untrusted.example")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("untrusted origin should be blocked, got %d", response.Code)
	}
}
