package inventory

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	DefaultBaseID  = "app3xn3iXAsm7MgA7"
	clusterTableID = "tblkCeiGBpVuHgpvy"
	nodeTableID    = "tbliN9Rr6EcMsfwuk"
)

type Cluster struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Environment     string  `json:"environment"`
	Status          string  `json:"status"`
	HealthStatus    string  `json:"healthStatus"`
	NodeCount       int     `json:"nodeCount"`
	ReadyNodeCount  int     `json:"readyNodeCount,omitempty"`
	PodCount        int     `json:"podCount"`
	CPUUsagePercent float64 `json:"cpuUsagePercent"`
	MemoryUsageMB   float64 `json:"memoryUsageMB"`
	RecordCreatedAt string  `json:"recordCreatedAt,omitempty"`
	LastSeenAt      string  `json:"lastSeenAt,omitempty"`
	LinkedNodeCount int     `json:"linkedNodeCount"`
	Source          string  `json:"source"`
}

type DataQuality struct {
	ClusterRecordCount          int      `json:"clusterRecordCount"`
	NodeRecordCount             int      `json:"nodeRecordCount"`
	NodeRecordsWithClusterLinks int      `json:"nodeRecordsWithClusterLinks"`
	ClustersWithLinkedNodes     int      `json:"clustersWithLinkedNodes"`
	LatestInventoryCreatedAt    string   `json:"latestInventoryCreatedAt,omitempty"`
	LatestNodeLastSeenAt        string   `json:"latestNodeLastSeenAt,omitempty"`
	InventoryAgeSeconds         *int64   `json:"inventoryAgeSeconds,omitempty"`
	TelemetryAgeSeconds         *int64   `json:"telemetryAgeSeconds,omitempty"`
	TelemetryFresh              bool     `json:"telemetryFresh"`
	Notes                       []string `json:"notes"`
}

type Snapshot struct {
	Source      string      `json:"source"`
	BaseID      string      `json:"baseId"`
	GeneratedAt time.Time   `json:"generatedAt"`
	Clusters    []Cluster   `json:"clusters"`
	DataQuality DataQuality `json:"dataQuality"`
}

type Store struct {
	mu       sync.RWMutex
	snapshot Snapshot
	client   *AirtableClient
}

type AirtableConfig struct {
	Token          string
	BaseID         string
	ClusterTableID string
	NodeTableID    string
	Timeout        time.Duration
}

type AirtableClient struct {
	token          string
	baseID         string
	clusterTableID string
	nodeTableID    string
	httpClient     *http.Client
}

func NewAirtableClient(cfg AirtableConfig) (*AirtableClient, error) {
	if strings.TrimSpace(cfg.Token) == "" {
		return nil, errors.New("Airtable token is required")
	}
	if cfg.BaseID == "" {
		cfg.BaseID = DefaultBaseID
	}
	if cfg.ClusterTableID == "" {
		cfg.ClusterTableID = clusterTableID
	}
	if cfg.NodeTableID == "" {
		cfg.NodeTableID = nodeTableID
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 12 * time.Second
	}
	return &AirtableClient{
		token: cfg.Token, baseID: cfg.BaseID, clusterTableID: cfg.ClusterTableID,
		nodeTableID: cfg.NodeTableID, httpClient: &http.Client{Timeout: cfg.Timeout},
	}, nil
}

func NewStore(snapshotPath string, client *AirtableClient) (*Store, error) {
	snapshot, err := LoadSnapshot(snapshotPath)
	if err != nil {
		return nil, err
	}
	return &Store{snapshot: snapshot, client: client}, nil
}

func LoadSnapshot(path string) (Snapshot, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Snapshot{}, fmt.Errorf("read Airtable inventory snapshot: %w", err)
	}
	var document struct {
		Source      string `json:"source"`
		BaseID      string `json:"baseId"`
		ExportedAt  string `json:"exportedAt"`
		GeneratedAt string `json:"generatedAt"`
		Clusters    struct {
			Records []struct {
				SourceRecordID  string  `json:"sourceRecordId"`
				ClusterName     string  `json:"clusterName"`
				Environment     string  `json:"environment"`
				Status          string  `json:"status"`
				NodeCount       int     `json:"nodeCount"`
				PodCount        int     `json:"podCount"`
				CPUUsagePercent float64 `json:"cpuUsagePercent"`
				MemoryUsageMB   float64 `json:"memoryUsageMB"`
				HealthStatus    string  `json:"healthStatus"`
				RecordCreatedAt string  `json:"recordCreatedAt"`
				LastSeenAt      string  `json:"lastSeenAt"`
				LinkedNodeCount int     `json:"linkedNodeCount"`
			} `json:"records"`
		} `json:"clusters"`
		RelatedTableFreshness struct {
			Nodes struct {
				RecordCount            int    `json:"recordCount"`
				LatestLastSeenAt       string `json:"latestLastSeenAt"`
				RecordsWithClusterLink int    `json:"recordsWithClusterLink"`
			} `json:"nodes"`
		} `json:"relatedTableFreshness"`
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		return Snapshot{}, fmt.Errorf("decode Airtable inventory snapshot: %w", err)
	}
	stamp := document.GeneratedAt
	if stamp == "" {
		stamp = document.ExportedAt
	}
	generatedAt, _ := time.Parse(time.RFC3339Nano, stamp)
	if generatedAt.IsZero() {
		generatedAt = time.Now().UTC()
	}
	s := Snapshot{Source: "airtable_snapshot", BaseID: document.BaseID, GeneratedAt: generatedAt}
	if s.BaseID == "" {
		s.BaseID = DefaultBaseID
	}
	for _, row := range document.Clusters.Records {
		s.Clusters = append(s.Clusters, Cluster{
			ID: row.SourceRecordID, Name: row.ClusterName, Environment: row.Environment,
			Status: row.Status, HealthStatus: row.HealthStatus, NodeCount: row.NodeCount,
			PodCount: row.PodCount, CPUUsagePercent: row.CPUUsagePercent,
			MemoryUsageMB: row.MemoryUsageMB, RecordCreatedAt: row.RecordCreatedAt,
			LastSeenAt: row.LastSeenAt, LinkedNodeCount: row.LinkedNodeCount, Source: "airtable",
		})
	}
	s.DataQuality = DataQuality{
		ClusterRecordCount:          len(s.Clusters),
		NodeRecordCount:             document.RelatedTableFreshness.Nodes.RecordCount,
		NodeRecordsWithClusterLinks: document.RelatedTableFreshness.Nodes.RecordsWithClusterLink,
		LatestNodeLastSeenAt:        document.RelatedTableFreshness.Nodes.LatestLastSeenAt,
		TelemetryFresh:              false,
		Notes: []string{
			"Airtable cluster rows are inventory snapshots, not live Kubernetes telemetry.",
			"Node, pod, anomaly and incident child-table timestamps are historical; verify against a live cluster agent.",
			"Reported API endpoints are unverified metadata and are never used as connection targets.",
		},
	}
	s.recalculateQuality()
	return s, nil
}

func (s *Store) LiveSyncEnabled() bool { return s.client != nil }

func (s *Store) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	copy := s.snapshot
	copy.Clusters = append([]Cluster(nil), s.snapshot.Clusters...)
	copy.DataQuality.Notes = append([]string(nil), s.snapshot.DataQuality.Notes...)
	return copy
}

func (s *Store) Refresh(ctx context.Context) error {
	if s.client == nil {
		return errors.New("live Airtable sync is not configured; serving sanitized snapshot")
	}
	next, err := s.client.Fetch(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.snapshot = next
	s.mu.Unlock()
	return nil
}

func (s *Store) Start(ctx context.Context, interval time.Duration, onError func(error)) {
	if s.client == nil {
		return
	}
	if interval <= 0 {
		interval = 5 * time.Minute
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				refreshCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
				err := s.Refresh(refreshCtx)
				cancel()
				if err != nil && onError != nil {
					onError(err)
				}
			}
		}
	}()
}

func (s *Snapshot) recalculateQuality() {
	now := time.Now().UTC()
	latestInventory := time.Time{}
	latestTelemetry := time.Time{}
	linked := 0
	for _, c := range s.Clusters {
		if c.LinkedNodeCount > 0 {
			linked++
		}
		if t, err := time.Parse(time.RFC3339Nano, c.RecordCreatedAt); err == nil && t.After(latestInventory) {
			latestInventory = t
		}
		if t, err := time.Parse(time.RFC3339Nano, c.LastSeenAt); err == nil && t.After(latestTelemetry) {
			latestTelemetry = t
		}
	}
	s.DataQuality.ClusterRecordCount = len(s.Clusters)
	s.DataQuality.ClustersWithLinkedNodes = linked
	if !latestInventory.IsZero() {
		s.DataQuality.LatestInventoryCreatedAt = latestInventory.Format(time.RFC3339)
		age := int64(now.Sub(latestInventory).Seconds())
		s.DataQuality.InventoryAgeSeconds = &age
	}
	if latestTelemetry.IsZero() && s.DataQuality.LatestNodeLastSeenAt != "" {
		latestTelemetry, _ = time.Parse(time.RFC3339Nano, s.DataQuality.LatestNodeLastSeenAt)
	}
	if !latestTelemetry.IsZero() {
		s.DataQuality.LatestNodeLastSeenAt = latestTelemetry.Format(time.RFC3339)
		age := int64(now.Sub(latestTelemetry).Seconds())
		s.DataQuality.TelemetryAgeSeconds = &age
		s.DataQuality.TelemetryFresh = age >= 0 && age < int64(15*time.Minute.Seconds())
	} else {
		s.DataQuality.TelemetryFresh = false
	}
}

type airtableRecord struct {
	ID          string         `json:"id"`
	CreatedTime string         `json:"createdTime"`
	Fields      map[string]any `json:"fields"`
}

type airtablePage struct {
	Records []airtableRecord `json:"records"`
	Offset  string           `json:"offset"`
}

func (c *AirtableClient) Fetch(ctx context.Context) (Snapshot, error) {
	clusterFields := []string{"Cluster Name", "Environment", "Status", "Node Count", "Pod Count", "CPU Usage (%)", "Memory Usage (MB)", "Health Status", "Onboarding Date", "Nodes"}
	nodeFields := []string{"Cluster", "Last Seen"}
	clusters, err := c.fetchRecords(ctx, c.clusterTableID, clusterFields)
	if err != nil {
		return Snapshot{}, fmt.Errorf("fetch Airtable clusters: %w", err)
	}
	nodes, err := c.fetchRecords(ctx, c.nodeTableID, nodeFields)
	if err != nil {
		return Snapshot{}, fmt.Errorf("fetch Airtable node freshness: %w", err)
	}

	nodeCounts := map[string]int{}
	lastSeen := map[string]time.Time{}
	globalLatestSeen := time.Time{}
	for _, node := range nodes {
		links, _ := node.Fields["Cluster"].([]any)
		stamp, _ := node.Fields["Last Seen"].(string)
		seen, _ := time.Parse(time.RFC3339Nano, stamp)
		if seen.After(globalLatestSeen) {
			globalLatestSeen = seen
		}
		for _, item := range links {
			link, _ := item.(map[string]any)
			clusterID, _ := link["id"].(string)
			if clusterID == "" {
				continue
			}
			nodeCounts[clusterID]++
			if seen.After(lastSeen[clusterID]) {
				lastSeen[clusterID] = seen
			}
		}
	}
	out := Snapshot{Source: "airtable_live", BaseID: c.baseID, GeneratedAt: time.Now().UTC()}
	latestCreated := time.Time{}
	latestSeen := globalLatestSeen
	for _, row := range clusters {
		f := row.Fields
		name := stringField(f, "Cluster Name")
		if name == "" {
			continue
		}
		created, _ := time.Parse(time.RFC3339Nano, row.CreatedTime)
		if created.After(latestCreated) {
			latestCreated = created
		}
		seen := lastSeen[row.ID]
		if seen.After(latestSeen) {
			latestSeen = seen
		}
		count := nodeCounts[row.ID]
		if count == 0 {
			if links, ok := f["Nodes"].([]any); ok {
				count = len(links)
			}
		}
		out.Clusters = append(out.Clusters, Cluster{
			ID: row.ID, Name: name, Environment: selectName(f["Environment"]), Status: selectName(f["Status"]),
			HealthStatus: selectName(f["Health Status"]), NodeCount: intField(f, "Node Count"),
			PodCount: intField(f, "Pod Count"), CPUUsagePercent: floatField(f, "CPU Usage (%)"),
			MemoryUsageMB: floatField(f, "Memory Usage (MB)"), RecordCreatedAt: row.CreatedTime,
			LastSeenAt: seen.Format(time.RFC3339), LinkedNodeCount: count, Source: "airtable",
		})
	}
	out.DataQuality = DataQuality{
		ClusterRecordCount: len(out.Clusters), NodeRecordCount: len(nodes),
		NodeRecordsWithClusterLinks: countLinkedNodes(nodes), TelemetryFresh: false,
		Notes: []string{
			"Inventory values are Airtable-reported metadata and are not a live metrics stream.",
			"Node Last Seen is evaluated separately from the inventory import timestamp.",
			"Reported API endpoints are not used as connection targets; cluster agents must register securely.",
		},
	}
	if !latestCreated.IsZero() {
		out.DataQuality.LatestInventoryCreatedAt = latestCreated.Format(time.RFC3339)
	}
	if !latestSeen.IsZero() {
		out.DataQuality.LatestNodeLastSeenAt = latestSeen.Format(time.RFC3339)
	}
	out.recalculateQuality()
	return out, nil
}

func (c *AirtableClient) fetchRecords(ctx context.Context, table string, fields []string) ([]airtableRecord, error) {
	var all []airtableRecord
	var offset string
	for {
		u := url.URL{Scheme: "https", Host: "api.airtable.com", Path: "/v0/" + c.baseID + "/" + table}
		q := u.Query()
		q.Set("pageSize", "100")
		for _, field := range fields {
			q.Add("fields[]", field)
		}
		if offset != "" {
			q.Set("offset", offset)
		}
		u.RawQuery = q.Encode()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+c.token)
		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			resp.Body.Close()
			return nil, fmt.Errorf("Airtable returned HTTP %d", resp.StatusCode)
		}
		var page airtablePage
		err = json.NewDecoder(resp.Body).Decode(&page)
		resp.Body.Close()
		if err != nil {
			return nil, err
		}
		all = append(all, page.Records...)
		offset = page.Offset
		if offset == "" {
			break
		}
	}
	return all, nil
}

func stringField(fields map[string]any, key string) string {
	value, _ := fields[key].(string)
	return strings.TrimSpace(value)
}
func selectName(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	if obj, ok := value.(map[string]any); ok {
		name, _ := obj["name"].(string)
		return name
	}
	return ""
}
func intField(fields map[string]any, key string) int {
	v, _ := strconv.ParseFloat(fmt.Sprint(fields[key]), 64)
	return int(v)
}
func floatField(fields map[string]any, key string) float64 {
	v, _ := strconv.ParseFloat(fmt.Sprint(fields[key]), 64)
	return v
}
func countLinkedNodes(nodes []airtableRecord) int {
	count := 0
	for _, n := range nodes {
		if links, ok := n.Fields["Cluster"].([]any); ok && len(links) > 0 {
			count++
		}
	}
	return count
}
