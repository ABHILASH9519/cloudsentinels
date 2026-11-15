package httpapi

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ABHILASH9519/cloudsentinels/internal/config"
)

func TestAgentEventRequiresAgentTokenAndAcceptsValidEvent(t *testing.T) {
	token := strings.Repeat("a", 40)
	server := NewServer(config.Config{AgentToken: token}, slog.New(slog.NewTextHandler(discardWriter{}, nil)), nil)
	body := `{"clusterId":"cloudsentinels-local","clusterName":"cloudsentinels-local","eventId":"k8s-0123456789abcdef","eventType":"PodCrashLoopBackOff","severity":"high","title":"Pod crash loop","summary":"Container restart backoff","resourceKind":"Pod","resourceName":"api-7","namespace":"cloudsentinels-system"}`

	unauthorized := httptest.NewRecorder()
	server.Handler().ServeHTTP(unauthorized, httptest.NewRequest(http.MethodPost, "/api/v1/agent/events", strings.NewReader(body)))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthenticated agent event to be rejected, got %d", unauthorized.Code)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/v1/agent/events", bytes.NewBufferString(body))
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("expected valid agent event to be accepted, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"eventId":"k8s-0123456789abcdef"`) {
		t.Fatalf("response did not acknowledge event ID: %s", response.Body.String())
	}
}

func TestAgentEventRejectsUnsupportedSeverity(t *testing.T) {
	token := strings.Repeat("b", 40)
	server := NewServer(config.Config{AgentToken: token}, slog.New(slog.NewTextHandler(discardWriter{}, nil)), nil)
	body := `{"clusterId":"cloudsentinels-local","eventId":"k8s-0123456789abcdef","eventType":"PodCrashLoopBackOff","severity":"catastrophic","title":"Pod crash loop"}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/agent/events", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected unsupported severity to be rejected, got %d", response.Code)
	}
}

func TestAgentEventCanRetryAfterN8nDeliveryFailure(t *testing.T) {
	token := strings.Repeat("r", 40)
	var attempts int32
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&attempts, 1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer hook.Close()
	cfg := config.Config{AgentToken: token, N8NWebhookURL: hook.URL, N8NSigningSecret: strings.Repeat("s", 48)}
	server := NewServer(cfg, slog.New(slog.NewTextHandler(discardWriter{}, nil)), nil)
	body := `{"clusterId":"cloudsentinels-local","clusterName":"cloudsentinels-local","eventId":"retry-event-001","eventType":"PodCrashLoopBackOff","severity":"high","title":"Pod crash loop","summary":"Container restart backoff","resourceKind":"Pod","resourceName":"api-7","namespace":"cloudsentinels-system"}`
	post := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/agent/events", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		res := httptest.NewRecorder()
		server.Handler().ServeHTTP(res, req)
		return res
	}
	if first := post(); first.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected retryable 503, got %d", first.Code)
	}
	if second := post(); second.Code != http.StatusAccepted {
		t.Fatalf("expected retry to be accepted, got %d: %s", second.Code, second.Body.String())
	}
	if got := atomic.LoadInt32(&attempts); got != 2 {
		t.Fatalf("expected two n8n attempts, got %d", got)
	}
}

func TestAgentTelemetryRetriesHeartbeatWhenN8nDeliveryFails(t *testing.T) {
	token := strings.Repeat("t", 40)
	var attempts int32
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&attempts, 1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer hook.Close()
	cfg := config.Config{AgentToken: token, N8NWebhookURL: hook.URL, N8NSigningSecret: strings.Repeat("s", 48)}
	server := NewServer(cfg, slog.New(slog.NewTextHandler(discardWriter{}, nil)), nil)
	body := `{"clusterId":"cloudsentinels-local","context":"cloudsentinels-local","sourceType":"kubernetes-agent","environment":"local","nodeCount":1,"readyNodeCount":1,"podCount":1,"healthyPodCount":1,"warningEvents":0}`
	post := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/agent/telemetry", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		res := httptest.NewRecorder()
		server.Handler().ServeHTTP(res, req)
		return res
	}
	if first := post(); first.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected retryable 503, got %d", first.Code)
	}
	server.telemetryMu.RLock()
	storedAfterFailure := len(server.localTelemetry)
	server.telemetryMu.RUnlock()
	if storedAfterFailure != 0 {
		t.Fatalf("telemetry should not be marked delivered before n8n accepts the heartbeat")
	}
	if second := post(); second.Code != http.StatusAccepted {
		t.Fatalf("expected retry to be accepted, got %d: %s", second.Code, second.Body.String())
	}
	if got := atomic.LoadInt32(&attempts); got != 2 {
		t.Fatalf("expected two n8n attempts, got %d", got)
	}
	server.telemetryMu.RLock()
	storedAfterSuccess := len(server.localTelemetry)
	server.telemetryMu.RUnlock()
	if storedAfterSuccess != 1 {
		t.Fatalf("expected accepted telemetry to be stored, got %d clusters", storedAfterSuccess)
	}
}
