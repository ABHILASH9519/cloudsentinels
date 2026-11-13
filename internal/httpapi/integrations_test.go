package httpapi

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ABHILASH9519/cloudsentinels/internal/automation"
	"github.com/ABHILASH9519/cloudsentinels/internal/config"
	"github.com/ABHILASH9519/cloudsentinels/internal/inventory"
)

func TestAirtableInventoryMonitoringAndAIEndpoints(t *testing.T) {
	store, err := inventory.NewStore("../../deploy/eks/airtable-inventory.snapshot.json", nil)
	if err != nil {
		t.Fatal(err)
	}
	server := NewServerWithServices(config.Config{ExecutionMode: "online-server"}, slog.Default(), testAuthenticator{}, store, nil, nil)
	for _, path := range []string{"/api/v1/inventory/clusters", "/api/v1/monitoring/summary", "/api/v1/ai/insights"} {
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK {
			t.Fatalf("%s: expected 200, got %d: %s", path, response.Code, response.Body.String())
		}
	}
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/inventory/clusters", nil))
	var payload struct {
		Count  int    `json:"count"`
		Source string `json:"source"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Count != 20 || payload.Source != "airtable_snapshot" {
		t.Fatalf("unexpected inventory response: %#v", payload)
	}
}

func TestSignedZapierCommandAndMutationGate(t *testing.T) {
	secret := "zapier-test-signing-secret-with-more-than-32-bytes"
	queue := automation.NewQueue()
	cfg := config.Config{ZapierSigningSecret: secret, AllowLocalMutations: false}
	server := NewServerWithServices(cfg, slog.Default(), testAuthenticator{}, nil, queue, nil)
	body := []byte(`{"commandId":"read-1","action":"collect-snapshot","clusterId":"minikube"}`)
	stamp := time.Now().UTC().Format(time.RFC3339)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/zapier/commands", bytes.NewReader(body))
	request.Header.Set("X-CS-Timestamp", stamp)
	request.Header.Set("X-CS-Signature", automation.Sign(secret, stamp, body))
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("expected signed read-only command accepted, got %d: %s", response.Code, response.Body.String())
	}
	if len(queue.List()) != 1 {
		t.Fatalf("expected one queued command, got %d", len(queue.List()))
	}

	mutation := []byte(`{"commandId":"mutate-1","action":"restart-deployment","clusterId":"minikube","namespace":"default","deployment":"api","approvalStatus":"approved","approvedBy":"operator"}`)
	stamp = time.Now().UTC().Format(time.RFC3339)
	request = httptest.NewRequest(http.MethodPost, "/api/v1/zapier/commands", bytes.NewReader(mutation))
	request.Header.Set("X-CS-Timestamp", stamp)
	request.Header.Set("X-CS-Signature", automation.Sign(secret, stamp, mutation))
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected server policy to block mutations, got %d", response.Code)
	}
}

func TestDesktopAgentTelemetryRequiresSeparateToken(t *testing.T) {
	token := "agent-token-with-at-least-32-characters"
	cfg := config.Config{AgentToken: token}
	server := NewServerWithServices(cfg, slog.Default(), testAuthenticator{}, nil, nil, nil)
	body := []byte(`{"clusterId":"minikube","context":"minikube","nodeCount":1,"podCount":2,"healthyPodCount":2,"warningEvents":0,"cpuUsagePercent":12.5,"memoryUsageMB":1024}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/agent/telemetry", bytes.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("expected telemetry accepted, got %d: %s", response.Code, response.Body.String())
	}
	request = httptest.NewRequest(http.MethodGet, "/api/v1/agent/telemetry", nil)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected authenticated telemetry read, got %d", response.Code)
	}
}
