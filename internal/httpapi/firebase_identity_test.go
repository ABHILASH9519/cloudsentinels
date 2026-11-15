package httpapi

import (
	"github.com/ABHILASH9519/cloudsentinels/internal/config"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCurrentUserReturnsVerifiedPrincipal(t *testing.T) {
	server := NewServer(config.Config{ExecutionMode: "online-server"}, nil, testAuthenticator{})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}
	for _, expected := range []string{`"authenticated":true`, `"uid":"test-user"`, `"roles":["operator"]`} {
		if !strings.Contains(res.Body.String(), expected) {
			t.Fatalf("missing %s in %s", expected, res.Body.String())
		}
	}
}

func TestCurrentUserFailsClosedWithoutAuthenticator(t *testing.T) {
	server := NewServer(config.Config{ExecutionMode: "online-server"}, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", res.Code)
	}
}
