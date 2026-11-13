package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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

func (testAuthenticator) Authenticate(*http.Request) (Principal, error) {
	return Principal{Subject: "test-user", Roles: []string{"operator"}}, nil
}

func TestAuthenticatedIncidentCreation(t *testing.T) {
	server := NewServer(config.Config{ExecutionMode: "online-server"}, slog.Default(), testAuthenticator{})
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
}
