package httpapi

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ABHILASH9519/cloudsentinels/internal/automation"
	"github.com/ABHILASH9519/cloudsentinels/internal/config"
)

func TestPerClusterAgentCredentialsAreBoundToClusterID(t *testing.T) {
	tokenOne := "prod-one-agent-token-0123456789abcdef"
	tokenTwo := "prod-two-agent-token-0123456789abcdef"
	queue := automation.NewQueue()
	_, err := queue.Enqueue(automation.Command{ID: "prod-one-command", Action: "collect-snapshot", ClusterID: "prod-cluster-1"})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServerWithServices(config.Config{AgentToken: strings.Repeat("g", 32), AgentTokens: map[string]string{"prod-cluster-1": tokenOne, "prod-cluster-2": tokenTwo}}, nil, nil, nil, queue, nil)

	request := httptest.NewRequest(http.MethodGet, "/api/v1/agent/commands?clusterId=prod-cluster-1", nil)
	request.Header.Set("Authorization", "Bearer "+tokenTwo)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("cluster two credential must not poll cluster one queue: %d", response.Code)
	}
	request = httptest.NewRequest(http.MethodGet, "/api/v1/agent/commands?clusterId=prod-cluster-1", nil)
	request.Header.Set("Authorization", "Bearer "+strings.Repeat("g", 32))
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("global fallback must be disabled when per-cluster tokens are configured: %d", response.Code)
	}

	request = httptest.NewRequest(http.MethodGet, "/api/v1/agent/commands?clusterId=prod-cluster-1", nil)
	request.Header.Set("Authorization", "Bearer "+tokenOne)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("cluster one agent should poll its queue: %d %s", response.Code, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodPost, "/api/v1/agent/commands/prod-one-command/result?clusterId=prod-cluster-1", bytes.NewBufferString(`{"status":"succeeded","result":"done"}`))
	request.Header.Set("Authorization", "Bearer "+tokenTwo)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("other cluster agent must not ack command: %d", response.Code)
	}
}
