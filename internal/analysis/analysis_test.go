package analysis

import (
	"testing"

	"github.com/ABHILASH9519/cloudsentinels/internal/inventory"
)

func TestAnalyzeFlagsHighCPUAndCriticalHealth(t *testing.T) {
	report := Analyze(inventory.Snapshot{Clusters: []inventory.Cluster{
		{ID: "critical", Name: "staging-03", Status: "Degraded", HealthStatus: "Critical", CPUUsagePercent: 91},
		{ID: "warning", Name: "qa-02", Status: "Degraded", HealthStatus: "Warning", CPUUsagePercent: 79},
		{ID: "healthy", Name: "dev-01", Status: "Active", HealthStatus: "Healthy", CPUUsagePercent: 35},
		{ID: "retired", Name: "legacy", Status: "Retired", HealthStatus: "Offline"},
	}})
	if len(report.Insights) != 2 {
		t.Fatalf("expected two actionable inventory insights, got %d", len(report.Insights))
	}
	if report.Insights[0].Severity != "critical" || report.Insights[0].ClusterName != "staging-03" {
		t.Fatalf("expected critical staging-03 insight, got %#v", report.Insights[0])
	}
	if !report.Insights[0].RequiresApproval {
		t.Fatal("critical recommendation must require approval")
	}
}

func TestAnalyzeLabelsMissingTelemetry(t *testing.T) {
	report := Analyze(inventory.Snapshot{Clusters: []inventory.Cluster{{ID: "x", Name: "qa-02", Status: "Degraded", HealthStatus: "Warning", CPUUsagePercent: 79}}})
	if len(report.Insights) != 1 || len(report.Insights[0].Evidence) < 2 {
		t.Fatalf("expected evidence to include missing live telemetry: %#v", report.Insights)
	}
}
