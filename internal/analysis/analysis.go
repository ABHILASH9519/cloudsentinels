package analysis

import (
	"fmt"
	"strings"
	"time"

	"github.com/ABHILASH9519/cloudsentinels/internal/inventory"
)

type Insight struct {
	ID               string    `json:"id"`
	ClusterID        string    `json:"clusterId"`
	ClusterName      string    `json:"clusterName"`
	Environment      string    `json:"environment"`
	Severity         string    `json:"severity"`
	Category         string    `json:"category"`
	Title            string    `json:"title"`
	Summary          string    `json:"summary"`
	Evidence         []string  `json:"evidence"`
	Recommended      []string  `json:"recommendedActions"`
	Confidence       float64   `json:"confidence"`
	Source           string    `json:"source"`
	GeneratedAt      time.Time `json:"generatedAt"`
	RequiresApproval bool      `json:"requiresApproval"`
}

type Report struct {
	Engine      string    `json:"engine"`
	GeneratedAt time.Time `json:"generatedAt"`
	Disclaimer  string    `json:"disclaimer"`
	Insights    []Insight `json:"insights"`
}

func Analyze(snapshot inventory.Snapshot) Report {
	now := time.Now().UTC()
	report := Report{
		Engine:      "CloudSentinels explainable rules engine v1",
		GeneratedAt: now,
		Disclaimer:  "Rule-based triage from Airtable-reported inventory snapshots. This is not a trained ML model or live telemetry; verify with an authenticated cluster agent before acting.",
		Insights:    []Insight{},
	}
	for _, cluster := range snapshot.Clusters {
		insight := evaluate(cluster, now)
		if insight != nil {
			report.Insights = append(report.Insights, *insight)
		}
	}
	return report
}

func evaluate(c inventory.Cluster, now time.Time) *Insight {
	status := strings.ToLower(c.Status)
	health := strings.ToLower(c.HealthStatus)
	severity, category, title := "", "capacity", ""
	evidence := []string{}
	actions := []string{}
	confidence := 0.65

	if status == "retired" {
		return nil
	}
	if health == "critical" || c.CPUUsagePercent >= 90 {
		severity, category = "critical", "capacity"
		title = fmt.Sprintf("%s requires immediate investigation", c.Name)
		evidence = append(evidence, fmt.Sprintf("Reported CPU utilization is %.0f%%.", c.CPUUsagePercent))
		if health == "critical" {
			evidence = append(evidence, "Airtable reports Critical health.")
		}
		actions = []string{"Verify current CPU usage with kubectl top nodes or Prometheus.", "Inspect node pressure and the highest-consuming pods.", "Check recent deployments and autoscaler events before changing capacity."}
		confidence = 0.91
	} else if health == "warning" || status == "degraded" || c.CPUUsagePercent >= 80 {
		severity, category = "high", "degradation"
		title = fmt.Sprintf("%s is reporting degraded health", c.Name)
		evidence = append(evidence, fmt.Sprintf("Reported CPU utilization is %.0f%%.", c.CPUUsagePercent))
		if status == "degraded" {
			evidence = append(evidence, "Cluster status is Degraded.")
		}
		if health == "warning" {
			evidence = append(evidence, "Health status is Warning.")
		}
		actions = []string{"Refresh live node and pod metrics.", "Inspect warning events, evictions and restart counts.", "Review recent rollouts and workload resource requests."}
		confidence = 0.84
	} else if status == "inactive" || status == "offline" || health == "offline" {
		severity, category = "medium", "availability"
		title = fmt.Sprintf("%s is reported offline", c.Name)
		evidence = append(evidence, "Airtable reports the cluster as inactive or offline.")
		actions = []string{"Confirm whether this cluster is intentionally stopped.", "If it should be running, verify the owner-approved control-plane endpoint and agent connectivity."}
		confidence = 0.78
	} else if status == "provisioning" || health == "unknown" {
		severity, category = "low", "onboarding"
		title = fmt.Sprintf("%s has not completed health validation", c.Name)
		evidence = append(evidence, "Airtable status or health is still Provisioning/Unknown.")
		actions = []string{"Complete secure agent onboarding.", "Run a read-only health check and reconcile actual node/pod counts."}
		confidence = 0.72
	} else {
		return nil
	}

	if c.NodeCount == 0 && status != "inactive" {
		evidence = append(evidence, "Reported node count is zero; verify this is not an incomplete inventory record.")
	}
	if c.LastSeenAt == "" {
		evidence = append(evidence, "No linked node Last Seen timestamp is available for this cluster in Airtable.")
		actions = append(actions, "Treat inventory metrics as a snapshot until a live agent reports telemetry.")
	}
	return &Insight{
		ID: c.ID + ":" + category, ClusterID: c.ID, ClusterName: c.Name,
		Environment: c.Environment, Severity: severity, Category: category,
		Title: title, Summary: "The triage engine identified a signal from the reported cluster inventory. The evidence and next checks are shown below; no remediation has been executed.",
		Evidence: evidence, Recommended: actions, Confidence: confidence,
		Source: "airtable_snapshot_rules", GeneratedAt: now, RequiresApproval: severity == "critical" || severity == "high",
	}
}
