package httpapi

import (
	"github.com/ABHILASH9519/cloudsentinels/internal/config"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRemediationPreviewIsDryRunOnly(t *testing.T) {
	server := NewServer(config.Config{ExecutionMode: "online-server", AllowLocalMutations: false}, nil, testAuthenticator{})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/remediation/preview", strings.NewReader(`{"action":"restart-deployment","clusterId":"cloudsentinels-local","namespace":"cloudsentinels-system","deployment":"airtable-inventory"}`))
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected preview 200, got %d: %s", res.Code, res.Body.String())
	}
	for _, expected := range []string{`"dryRun":true`, `"queued":false`, `"executed":false`, `"requiresHumanApproval":true`, `"serverMutationEnabled":false`} {
		if !strings.Contains(res.Body.String(), expected) {
			t.Fatalf("missing %s in %s", expected, res.Body.String())
		}
	}
	if len(server.automationQueue.List()) != 0 {
		t.Fatal("preview must not enqueue a command")
	}
}

func TestRemediationPreviewRejectsUnlistedAction(t *testing.T) {
	server := NewServer(config.Config{ExecutionMode: "online-server"}, nil, testAuthenticator{})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/remediation/preview", strings.NewReader(`{"action":"delete-namespace","clusterId":"local-cluster","namespace":"default","deployment":"api"}`))
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", res.Code)
	}
}
