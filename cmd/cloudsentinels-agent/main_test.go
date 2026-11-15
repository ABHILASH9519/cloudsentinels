package main

import (
	"encoding/hex"
	"strings"
	"testing"
	"time"

	"github.com/ABHILASH9519/cloudsentinels/internal/automation"
)

func TestAllowedAgentAPIURL(t *testing.T) {
	tests := []struct {
		name     string
		url      string
		internal bool
		want     bool
	}{
		{name: "https public", url: "https://api.example.com", want: true},
		{name: "localhost http", url: "http://127.0.0.1:8082", want: true},
		{name: "localhost hostname", url: "http://localhost:8082", want: true},
		{name: "internal service opt-in", url: "http://cloudsentinels-api.cloudsentinels-system.svc.cluster.local:8082", internal: true, want: true},
		{name: "internal service no opt-in", url: "http://cloudsentinels-api.cloudsentinels-system.svc.cluster.local:8082", want: false},
		{name: "public http blocked", url: "http://api.example.com", internal: true, want: false},
		{name: "invalid url", url: "://invalid", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := allowedAgentAPIURL(test.url, test.internal); got != test.want {
				t.Fatalf("allowedAgentAPIURL(%q, %t) = %t, want %t", test.url, test.internal, got, test.want)
			}
		})
	}
}

func TestMapKubernetesWarning(t *testing.T) {
	var pod kubeItem
	pod.Type = "Warning"
	pod.Reason = "BackOff"
	pod.Message = "Back-off restarting failed container"
	pod.InvolvedObject.Kind = "Pod"
	if eventType, severity, ok := mapKubernetesWarning(pod); !ok || eventType != "PodCrashLoopBackOff" || severity != "high" {
		t.Fatalf("unexpected pod warning mapping: %q %q %t", eventType, severity, ok)
	}

	var memory kubeItem
	memory.Type = "Warning"
	memory.Reason = "MemoryPressure"
	if eventType, severity, ok := mapKubernetesWarning(memory); !ok || eventType != "MemoryPressure" || severity != "high" {
		t.Fatalf("unexpected memory warning mapping: %q %q %t", eventType, severity, ok)
	}

	var normal kubeItem
	normal.Type = "Normal"
	normal.Reason = "Scheduled"
	if _, _, ok := mapKubernetesWarning(normal); ok {
		t.Fatal("normal Kubernetes events must not be forwarded as alerts")
	}
}

func TestStableEventIDAndLambdaSignature(t *testing.T) {
	first := stableEventID("cluster-a", "pod", "payments", "api-7", "BackOff")
	second := stableEventID("cluster-a", "pod", "payments", "api-7", "BackOff")
	if first != second || len(first) != 68 {
		t.Fatalf("event ID is not stable: %q %q", first, second)
	}

	raw := []byte(`{"eventId":"k8s-test","eventType":"NodeNotReady","severity":"critical"}`)
	signature := lambdaEventSignature("0123456789abcdef0123456789abcdef", "1794595400", "cluster-a", raw)
	decoded, err := hex.DecodeString(signature)
	if err != nil || len(decoded) != 32 {
		t.Fatalf("signature must be a 32-byte HMAC-SHA256 hex value: %q, %v", signature, err)
	}
	if signature == lambdaEventSignature("different-secret-0123456789abcdef", "1794595400", "cluster-a", raw) {
		t.Fatal("signature must change when the signing secret changes")
	}
}

func TestFilterRecentWarningsExcludesHistoricalAndNormalEvents(t *testing.T) {
	now := time.Now().UTC()
	recent := kubeItem{Type: "Warning", Reason: "BackOff", LastTimestamp: now.Add(-2 * time.Minute).Format(time.RFC3339Nano)}
	old := kubeItem{Type: "Warning", Reason: "BackOff", LastTimestamp: now.Add(-20 * time.Minute).Format(time.RFC3339Nano)}
	normal := kubeItem{Type: "Normal", Reason: "Scheduled", LastTimestamp: now.Format(time.RFC3339Nano)}
	invalid := kubeItem{Type: "Warning", Reason: "Unknown", LastTimestamp: "not-a-timestamp"}

	filtered := filterRecentWarnings([]kubeItem{recent, old, normal, invalid}, now, 5*time.Minute)
	if len(filtered) != 1 || filtered[0].Reason != "BackOff" {
		t.Fatalf("expected only the recent warning event, got %#v", filtered)
	}
}

func TestParseAllowedNamespacesDefaultsAndNormalizes(t *testing.T) {
	defaults := parseAllowedNamespaces("")
	if !defaults["cloudsentinels-system"] || len(defaults) != 1 {
		t.Fatalf("unexpected default namespace allowlist: %#v", defaults)
	}
	custom := parseAllowedNamespaces("cloudsentinels-system, Payments,invalid namespace")
	if !custom["cloudsentinels-system"] || !custom["payments"] || len(custom) != 2 {
		t.Fatalf("unexpected normalized namespace allowlist: %#v", custom)
	}
}

func TestExecuteBlocksMutationOutsideAllowedNamespace(t *testing.T) {
	a := &agent{
		clusterID:         "cluster-a",
		allowMutations:    true,
		allowedNamespaces: map[string]bool{"cloudsentinels-system": true},
	}
	command := automation.Command{
		ClusterID:      "cluster-a",
		Action:         "restart-deployment",
		Namespace:      "default",
		Deployment:     "test-api",
		ApprovalStatus: "approved",
		ApprovedBy:     "authorized-operator",
	}
	status, result := a.execute(command)
	if status != "blocked" || !strings.Contains(result, "namespace is not in") {
		t.Fatalf("mutation outside allowlist must be blocked, got %q: %s", status, result)
	}
}
