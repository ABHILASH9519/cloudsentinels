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
	StatusOpen         IncidentStatus = "open"
	StatusAcknowledged IncidentStatus = "acknowledged"
	StatusInvestigating IncidentStatus = "investigating"
	StatusResolved     IncidentStatus = "resolved"
)

type ExecutionTarget string

const (
	TargetOnlineServer    ExecutionTarget = "online-server"
	TargetOnlineServerless ExecutionTarget = "online-serverless"
	TargetOfflineKubernetes ExecutionTarget = "offline-kubernetes"
)

type Incident struct {
	ID             string          `json:"id"`
	Title          string          `json:"title"`
	Description    string          `json:"description"`
	Severity       Severity        `json:"severity"`
	Status         IncidentStatus  `json:"status"`
	Source         string          `json:"source"`
	Target         ExecutionTarget `json:"target"`
	DetectedAt     time.Time       `json:"detectedAt"`
	CorrelationID  string          `json:"correlationId,omitempty"`
}

var ErrInvalidIncident = errors.New("invalid incident")

func (i Incident) Validate() error {
	if strings.TrimSpace(i.Title) == "" || strings.TrimSpace(i.Source) == "" {
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
	if i.Status == "" {
		return ErrInvalidIncident
	}
	return nil
}
