package automation

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	clusterIDPattern    = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	commandIDPattern    = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	resourceNamePattern = regexp.MustCompile(`^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$`)
)

type Command struct {
	ID             string    `json:"id"`
	Action         string    `json:"action"`
	ClusterID      string    `json:"clusterId"`
	Namespace      string    `json:"namespace,omitempty"`
	Deployment     string    `json:"deployment,omitempty"`
	ApprovalStatus string    `json:"approvalStatus"`
	ApprovedBy     string    `json:"approvedBy,omitempty"`
	RequestedBy    string    `json:"requestedBy,omitempty"`
	Status         string    `json:"status"`
	Result         string    `json:"result,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type Event struct {
	SchemaVersion string    `json:"schemaVersion"`
	EventID       string    `json:"eventId"`
	EventType     string    `json:"eventType"`
	OccurredAt    time.Time `json:"occurredAt"`
	ClusterID     string    `json:"clusterId,omitempty"`
	ClusterName   string    `json:"clusterName,omitempty"`
	SourceType    string    `json:"sourceType,omitempty"`
	Environment   string    `json:"environment,omitempty"`
	Severity      string    `json:"severity,omitempty"`
	Title         string    `json:"title,omitempty"`
	Summary       string    `json:"summary,omitempty"`
}

type Queue struct {
	mu    sync.Mutex
	items map[string]Command
}

func NewQueue() *Queue { return &Queue{items: make(map[string]Command)} }

func (q *Queue) Enqueue(command Command) (Command, error) {
	if !clusterIDPattern.MatchString(command.ClusterID) {
		return Command{}, errors.New("clusterId is required and must be a safe identifier")
	}
	switch command.Action {
	case "collect-snapshot":
		if command.ApprovalStatus == "" {
			command.ApprovalStatus = "not-required"
		}
	case "rollout-status":
		if !resourceNamePattern.MatchString(command.Namespace) || !resourceNamePattern.MatchString(command.Deployment) {
			return Command{}, errors.New("rollout-status requires valid namespace and deployment names")
		}
		if command.ApprovalStatus == "" {
			command.ApprovalStatus = "not-required"
		}
	case "restart-deployment":
		if command.ApprovalStatus != "approved" || strings.TrimSpace(command.ApprovedBy) == "" {
			return Command{}, errors.New("restart-deployment requires an explicit approved status and approvedBy identity")
		}
		if !resourceNamePattern.MatchString(command.Namespace) || !resourceNamePattern.MatchString(command.Deployment) {
			return Command{}, errors.New("restart-deployment requires valid namespace and deployment names")
		}
	default:
		return Command{}, errors.New("action is not in the CloudSentinels CLI allowlist")
	}
	now := time.Now().UTC()
	if command.ID == "" {
		command.ID = fmt.Sprintf("cmd-%d", now.UnixNano())
	}
	if !commandIDPattern.MatchString(command.ID) {
		return Command{}, errors.New("commandId must be a safe identifier")
	}
	if len(command.ApprovedBy) > 254 || len(command.RequestedBy) > 254 {
		return Command{}, errors.New("approval and requester identities exceed allowed length")
	}
	command.Status = "queued"
	command.CreatedAt, command.UpdatedAt = now, now
	q.mu.Lock()
	defer q.mu.Unlock()
	if existing, exists := q.items[command.ID]; exists {
		if existing.Action != command.Action || existing.ClusterID != command.ClusterID || existing.Namespace != command.Namespace || existing.Deployment != command.Deployment {
			return Command{}, errors.New("commandId is already used for a different action")
		}
		return existing, nil
	}
	q.items[command.ID] = command
	return command, nil
}

func (q *Queue) Pending(limit int) []Command { return q.PendingForCluster("", limit) }

func (q *Queue) PendingForCluster(clusterID string, limit int) []Command {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	now := time.Now().UTC()
	for id, item := range q.items {
		if item.Status == "dispatched" && now.Sub(item.UpdatedAt) > 2*time.Minute {
			item.Status = "queued"
			item.UpdatedAt = now
			q.items[id] = item
		}
	}
	items := make([]Command, 0)
	for _, item := range q.items {
		if clusterID != "" && item.ClusterID != clusterID {
			continue
		}
		if item.Status != "queued" {
			continue
		}
		if item.Action == "restart-deployment" && item.ApprovalStatus != "approved" {
			continue
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.Before(items[j].CreatedAt) })
	if len(items) > limit {
		items = items[:limit]
	}
	for i := range items {
		items[i].Status = "dispatched"
		items[i].UpdatedAt = time.Now().UTC()
		q.items[items[i].ID] = items[i]
	}
	return items
}

func (q *Queue) Complete(id, status, result string) (Command, bool) {
	return q.CompleteForCluster(id, "", status, result)
}

func (q *Queue) CompleteForCluster(id, clusterID, status, result string) (Command, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	item, ok := q.items[id]
	if !ok || item.Status != "dispatched" || (clusterID != "" && item.ClusterID != clusterID) {
		return Command{}, false
	}
	if status != "succeeded" && status != "failed" && status != "blocked" {
		status = "failed"
	}
	item.Status, item.Result, item.UpdatedAt = status, truncate(result, 4000), time.Now().UTC()
	q.items[id] = item
	return item, true
}

func (q *Queue) List() []Command {
	q.mu.Lock()
	defer q.mu.Unlock()
	items := make([]Command, 0, len(q.items))
	for _, item := range q.items {
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.After(items[j].CreatedAt) })
	return items
}

func Sign(secret, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "."))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func Verify(secret, timestamp, signature string, body []byte, now time.Time) error {
	if strings.TrimSpace(secret) == "" {
		return errors.New("webhook signing secret is not configured")
	}
	ts, err := time.Parse(time.RFC3339, timestamp)
	if err != nil || now.Sub(ts) > 5*time.Minute || ts.Sub(now) > 5*time.Minute {
		return errors.New("webhook timestamp is invalid or expired")
	}
	provided, err := hex.DecodeString(strings.TrimSpace(signature))
	if err != nil {
		return errors.New("webhook signature is malformed")
	}
	expected, _ := hex.DecodeString(Sign(secret, timestamp, body))
	if !hmac.Equal(provided, expected) {
		return errors.New("webhook signature verification failed")
	}
	return nil
}

type Dispatcher struct {
	URL    string
	Secret string
	Client *http.Client
}

func (d *Dispatcher) Enabled() bool {
	return strings.TrimSpace(d.URL) != "" && strings.TrimSpace(d.Secret) != ""
}

func (d *Dispatcher) Send(event Event) error {
	if !d.Enabled() {
		return errors.New("Zapier outbound webhook is not configured")
	}
	if d.Client == nil {
		d.Client = &http.Client{Timeout: 8 * time.Second}
	}
	if event.SchemaVersion == "" {
		event.SchemaVersion = "1"
	}
	if event.EventID == "" {
		event.EventID = fmt.Sprintf("evt-%d", time.Now().UnixNano())
	}
	if event.OccurredAt.IsZero() {
		event.OccurredAt = time.Now().UTC()
	}
	body, err := json.Marshal(event)
	if err != nil {
		return err
	}
	timestamp := time.Now().UTC().Format(time.RFC3339)
	req, err := http.NewRequest(http.MethodPost, d.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CS-Timestamp", timestamp)
	req.Header.Set("X-CS-Signature", Sign(d.Secret, timestamp, body))
	req.Header.Set("X-CS-Event-ID", event.EventID)
	resp, err := d.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Zapier webhook returned HTTP %d", resp.StatusCode)
	}
	return nil
}

func truncate(value string, max int) string {
	if len(value) > max {
		return value[:max]
	}
	return value
}
