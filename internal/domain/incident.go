package domain

import (
	"errors"
	"strings"
	"time"
)

type Severity string

const (
	SeverityInfo     Severity = "info"
	SeverityLow      Severity = "low"
	SeverityMedium   Severity = "medium"
	SeverityHigh     Severity = "high"
	SeverityCritical Severity = "critical"
)

type IncidentStatus string

const (
	StatusOpen          IncidentStatus = "open"
	StatusAcknowledged  IncidentStatus = "acknowledged"
	StatusInvestigating IncidentStatus = "investigating"
	StatusResolved      IncidentStatus = "resolved"
)

type ExecutionTarget string

const (
	TargetOnlineServer      ExecutionTarget = "online-server"
	TargetOnlineServerless  ExecutionTarget = "online-serverless"
	TargetOfflineKubernetes ExecutionTarget = "offline-kubernetes"
)

type Incident struct {
	ID            string          `json:"id"`
	Title         string          `json:"title"`
	Description   string          `json:"description"`
	Severity      Severity        `json:"severity"`
	Status        IncidentStatus  `json:"status"`
	Source        string          `json:"source"`
	Target        ExecutionTarget `json:"target"`
	DetectedAt    time.Time       `json:"detectedAt"`
	CorrelationID string          `json:"correlationId,omitempty"`
	Assignee      string          `json:"assignee,omitempty"`
	RawLog        string          `json:"rawLog,omitempty"`
	AISummary     string          `json:"aiSummary,omitempty"`
	RootCause     string          `json:"rootCause,omitempty"`
	SuggestedFix  string          `json:"suggestedFix,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// IncidentComment is a human note attached to an incident.
type IncidentComment struct {
	ID         string    `json:"id"`
	IncidentID string    `json:"incidentId"`
	Author     string    `json:"author"`
	Text       string    `json:"text"`
	CreatedAt  time.Time `json:"createdAt"`
}

var ErrInvalidIncident = errors.New("invalid incident")

func (i Incident) Validate() error {
	if strings.TrimSpace(i.Title) == "" || len(i.Title) > 200 ||
		strings.TrimSpace(i.Source) == "" || len(i.Source) > 100 ||
		len(i.Description) > 10000 || len(i.CorrelationID) > 128 ||
		len(i.RawLog) > 20000 || len(i.AISummary) > 5000 ||
		len(i.RootCause) > 5000 || len(i.SuggestedFix) > 5000 ||
		len(i.Assignee) > 100 {
		return ErrInvalidIncident
	}
	switch i.Severity {
	case SeverityInfo, SeverityLow, SeverityMedium, SeverityHigh, SeverityCritical:
	default:
		return ErrInvalidIncident
	}
	switch i.Target {
	case TargetOnlineServer, TargetOnlineServerless, TargetOfflineKubernetes:
	default:
		return ErrInvalidIncident
	}
	switch i.Status {
	case StatusOpen, StatusAcknowledged, StatusInvestigating, StatusResolved:
	default:
		return ErrInvalidIncident
	}
	for _, value := range []string{i.AISummary, i.RootCause, i.SuggestedFix, i.RawLog} {
		if containsControlCharacters(value) {
			return ErrInvalidIncident
		}
	}
	return nil
}

// Validate checks a comment's required fields and length bounds.
func (c IncidentComment) Validate() error {
	if strings.TrimSpace(c.Text) == "" || len(c.Text) > 4000 || len(c.Author) > 100 {
		return ErrInvalidIncident
	}
	if containsControlCharacters(c.Text) || containsControlCharacters(c.Author) {
		return ErrInvalidIncident
	}
	return nil
}

// containsControlCharacters reports whether value holds control bytes other than
// common whitespace, which are never valid in operator-entered text fields.
func containsControlCharacters(value string) bool {
	for _, char := range value {
		if char == '\n' || char == '\r' || char == '\t' {
			continue
		}
		if char < 0x20 || char == 0x7f {
			return true
		}
	}
	return false
}
