package inventory

import "testing"

func TestLoadSnapshotIsSanitizedAndInventoryOnly(t *testing.T) {
	snapshot, err := LoadSnapshot("../../deploy/eks/airtable-inventory.snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Clusters) != 20 {
		t.Fatalf("expected 20 cluster rows, got %d", len(snapshot.Clusters))
	}
	if snapshot.Source != "airtable_snapshot" {
		t.Fatalf("unexpected source: %s", snapshot.Source)
	}
	if snapshot.DataQuality.TelemetryFresh {
		t.Fatal("historical/unlinked node telemetry must not be reported as fresh")
	}
	if snapshot.DataQuality.NodeRecordsWithClusterLinks != 0 {
		t.Fatalf("expected no linked node records, got %d", snapshot.DataQuality.NodeRecordsWithClusterLinks)
	}
	if snapshot.DataQuality.LatestNodeLastSeenAt == "" || snapshot.DataQuality.TelemetryAgeSeconds == nil || *snapshot.DataQuality.TelemetryAgeSeconds < 365*24*60*60 {
		t.Fatalf("historical node Last Seen must be surfaced as stale: %#v", snapshot.DataQuality)
	}
	for _, cluster := range snapshot.Clusters {
		if cluster.Name == "" {
			t.Fatal("cluster name is required")
		}
		if cluster.Source != "airtable" {
			t.Fatalf("unexpected cluster source %q", cluster.Source)
		}
	}
}
