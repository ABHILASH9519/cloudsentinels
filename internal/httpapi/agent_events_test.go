package httpapi

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
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
