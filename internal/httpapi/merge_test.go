package httpapi

import (
	"testing"
	"time"

	"github.com/ABHILASH9519/cloudsentinels/internal/inventory"
)

func TestMergeLocalTelemetryReconcilesAirtableClusterWithoutDuplicate(t *testing.T) {
	clusters := []inventory.Cluster{{ID: "rec-prod-1", Name: "prod-cluster-1", Environment: "Production", Status: "Degraded", HealthStatus: "Critical", NodeCount: 3, PodCount: 10, CPUUsagePercent: 91, Source: "airtable"}}
	telemetry := []LocalTelemetry{{ClusterID: "rec-prod-1", Context: "prod-context", NodeCount: 3, ReadyNodeCount: 3, PodCount: 10, HealthyPodCount: 10, CPUUsagePercent: 34, MemoryUsageMB: 4096, CollectedAt: time.Now().UTC()}}
	merged := mergeLocalTelemetry(clusters, telemetry)
	if len(merged) != 1 {
		t.Fatalf("expected existing Airtable record to be updated, not duplicated: %d", len(merged))
	}
	if merged[0].Name != "prod-cluster-1" || merged[0].Environment != "Production" {
		t.Fatalf("Airtable identity should be preserved: %#v", merged[0])
	}
	if merged[0].Source != "desktop_agent" || merged[0].HealthStatus != "Healthy" || merged[0].CPUUsagePercent != 34 || merged[0].ReadyNodeCount != 3 {
		t.Fatalf("live agent metrics not merged: %#v", merged[0])
	}
}

func TestMergeLocalTelemetryMarksStaleAgentOffline(t *testing.T) {
	merged := mergeLocalTelemetry([]inventory.Cluster{{ID: "minikube", Name: "minikube", Status: "Active"}}, []LocalTelemetry{{ClusterID: "minikube", Context: "minikube", NodeCount: 1, ReadyNodeCount: 1, PodCount: 1, HealthyPodCount: 1, CollectedAt: time.Now().Add(-5 * time.Minute)}})
	if len(merged) != 1 || merged[0].Status != "Offline" || merged[0].HealthStatus != "Unknown" {
		t.Fatalf("stale telemetry must be visibly offline: %#v", merged)
	}
}
