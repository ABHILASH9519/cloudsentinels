package domain

import "testing"

func TestIncidentValidation(t *testing.T) {
	valid := Incident{
		Title: "Pod crash loop", Source: "prometheus",
		Severity: SeverityHigh, Status: StatusOpen, Target: TargetOfflineKubernetes,
	}
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid incident rejected: %v", err)
	}

	cases := []struct {
		name string
		edit func(*Incident)
	}{
		{"unknown status", func(i *Incident) { i.Status = "unknown" }},
		{"unknown severity", func(i *Incident) { i.Severity = "urgent" }},
		{"unknown target", func(i *Incident) { i.Target = "unknown" }},
		{"empty title", func(i *Incident) { i.Title = "  " }},
		{"oversized title", func(i *Incident) { i.Title = string(make([]byte, 201)) }},
		{"oversized description", func(i *Incident) { i.Description = string(make([]byte, 10001)) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			item := valid
			tc.edit(&item)
			if err := item.Validate(); err == nil {
				t.Fatal("expected invalid incident to be rejected")
			}
		})
	}
}
