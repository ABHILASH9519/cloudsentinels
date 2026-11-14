package httpapi

import (
	"bytes"
	"context"
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

func TestLocalAgentTelemetryEmitsZapierHealthTransitions(t *testing.T) {
	events := make(chan automation.Event, 8)
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var event automation.Event
		if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
			t.Errorf("decode webhook event: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		events <- event
		w.WriteHeader(http.StatusAccepted)
	}))
	defer hook.Close()

	dispatcher := &automation.Dispatcher{URL: hook.URL, Secret: "local-test-signing-secret-with-more-than-32-bytes"}
	token := "agent-token-with-at-least-32-characters"
	server := NewServerWithServices(config.Config{AgentToken: token}, slog.Default(), testAuthenticator{}, nil, nil, dispatcher)

	sendTelemetry := func(readyNodes, healthyPods, warnings int) {
		t.Helper()
		payload, err := json.Marshal(LocalTelemetry{
			ClusterID: "kind-local", Context: "cloudsentinels-local", SourceType: "local-kubernetes", Environment: "local",
			NodeCount: 1, ReadyNodeCount: readyNodes, PodCount: 1, HealthyPodCount: healthyPods,
			WarningEvents: warnings, CollectedAt: time.Now().UTC(),
		})
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodPost, "/api/v1/agent/telemetry", bytes.NewReader(payload))
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusAccepted {
			t.Fatalf("expected telemetry accepted, got %d: %s", response.Code, response.Body.String())
		}
	}
	awaitEvent := func(expected string) automation.Event {
		t.Helper()
		select {
		case event := <-events:
			if event.EventType != expected {
				t.Fatalf("expected %s event, got %s", expected, event.EventType)
			}
			if event.SourceType != "local-kubernetes" || event.Environment != "local" || event.ClusterID != "kind-local" {
				t.Fatalf("unexpected event routing metadata: %#v", event)
			}
			return event
		case <-time.After(3 * time.Second):
			t.Fatalf("timed out waiting for %s event", expected)
			return automation.Event{}
		}
	}

	sendTelemetry(0, 0, 1)
	first := map[string]bool{}
	for len(first) < 2 {
		select {
		case event := <-events:
			first[event.EventType] = true
			if event.SourceType != "local-kubernetes" || event.Environment != "local" || event.ClusterID != "kind-local" {
				t.Fatalf("unexpected event routing metadata: %#v", event)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("timed out waiting for initial cluster events")
		}
	}
	if !first["cluster.online"] || !first["cluster.health.degraded"] {
		t.Fatalf("expected online and degraded events, got %#v", first)
	}

	sendTelemetry(1, 1, 0)
	awaitEvent("cluster.health.recovered")

	server.telemetryMu.Lock()
	stale := server.localTelemetry["kind-local"]
	stale.CollectedAt = time.Now().UTC().Add(-3 * time.Minute)
	server.localTelemetry["kind-local"] = stale
	server.telemetryMu.Unlock()
	monitorCtx, cancelMonitor := context.WithCancel(context.Background())
	defer cancelMonitor()
	server.StartTelemetryMonitor(monitorCtx, 10*time.Millisecond)
	awaitEvent("cluster.offline")
}

func TestAgentTelemetryPreservesRemoteClusterRoutingMetadata(t *testing.T) {
	events := make(chan automation.Event, 2)
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var event automation.Event
		if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
			t.Errorf("decode webhook event: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		events <- event
		w.WriteHeader(http.StatusAccepted)
	}))
	defer hook.Close()

	token := "agent-token-with-at-least-32-characters"
	server := NewServerWithServices(
		config.Config{AgentToken: token}, slog.Default(), testAuthenticator{}, nil, nil,
		&automation.Dispatcher{URL: hook.URL, Secret: "local-test-signing-secret-with-more-than-32-bytes"},
	)
	payload, err := json.Marshal(LocalTelemetry{
		ClusterID: "eks-prod-01", Context: "prod-ap-south-1",
		SourceType: "aws-eks", Environment: "production",
		NodeCount: 1, ReadyNodeCount: 1, PodCount: 1, HealthyPodCount: 1,
		CollectedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/agent/telemetry", bytes.NewReader(payload))
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("expected telemetry accepted, got %d: %s", response.Code, response.Body.String())
	}

	select {
	case event := <-events:
		if event.EventType != "cluster.online" || event.SourceType != "aws-eks" || event.Environment != "production" || event.ClusterID != "eks-prod-01" {
			t.Fatalf("remote cluster routing metadata was not preserved: %#v", event)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for remote cluster online event")
	}
}

func TestN8NTestEndpointAndPlatformStatus(t *testing.T) {
	secret := "n8n-test-signing-secret-with-more-than-32-bytes"
	events := make(chan automation.Event, 1)
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		if r.Header.Get("X-CS-Signature") == "" || r.Header.Get("X-CS-Timestamp") == "" {
			t.Error("expected signed n8n webhook headers")
		}
		var event automation.Event
		if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
			t.Error(err)
		}
		events <- event
		w.WriteHeader(http.StatusAccepted)
	}))
	defer hook.Close()
	cfg := config.Config{ExecutionMode: "online-server", N8NWebhookURL: hook.URL, N8NSigningSecret: secret}
	server := NewServerWithServices(cfg, slog.Default(), testAuthenticator{}, nil, nil, nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/n8n/test", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("expected n8n test delivered, got %d: %s", response.Code, response.Body.String())
	}
	select {
	case event := <-events:
		if event.EventType != "cloudsentinels.integration_test" {
			t.Fatalf("unexpected event: %#v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("n8n did not receive test event")
	}
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/platform", nil))
	var platform struct {
		Integrations map[string]string `json:"integrations"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &platform); err != nil {
		t.Fatal(err)
	}
	if platform.Integrations["n8n"] != "configured" {
		t.Fatalf("n8n status not reported: %#v", platform.Integrations)
	}
}

func TestEventFanoutSendsToZapierAndN8NIndependently(t *testing.T) {
	zapierEvents := make(chan automation.Event, 1)
	n8nEvents := make(chan automation.Event, 1)
	newHook := func(ch chan<- automation.Event) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer r.Body.Close()
			var event automation.Event
			if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
				t.Errorf("decode event: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			ch <- event
			w.WriteHeader(http.StatusAccepted)
		}))
	}
	zapierHook := newHook(zapierEvents)
	defer zapierHook.Close()
	n8nHook := newHook(n8nEvents)
	defer n8nHook.Close()
	zapierSecret := "zapier-test-secret-with-more-than-32-characters"
	n8nSecret := "n8n-test-secret-with-more-than-32-characters"
	cfg := config.Config{ExecutionMode: "online-server", N8NWebhookURL: n8nHook.URL, N8NSigningSecret: n8nSecret}
	dispatcher := &automation.Dispatcher{URL: zapierHook.URL, Secret: zapierSecret, Client: zapierHook.Client()}
	server := NewServerWithServices(cfg, slog.Default(), testAuthenticator{}, nil, nil, dispatcher)
	server.emitAutomationEvent("fanout-test", automation.Event{EventType: "cluster.health.degraded", EventID: "fanout-1", Severity: "warning"}, 0)
	for name, ch := range map[string]<-chan automation.Event{"Zapier": zapierEvents, "n8n": n8nEvents} {
		select {
		case event := <-ch:
			if event.EventID != "fanout-1" {
				t.Fatalf("%s received wrong event: %#v", name, event)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("%s did not receive event", name)
		}
	}
}
