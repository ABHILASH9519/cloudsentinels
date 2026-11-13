package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ABHILASH9519/cloudsentinels/internal/automation"
	"github.com/ABHILASH9519/cloudsentinels/internal/httpapi"
)

var safeResource = regexp.MustCompile(`^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$`)

type agent struct {
	apiURL         string
	token          string
	clusterID      string
	context        string
	allowMutations bool
	client         *http.Client
}

type kubeList struct {
	Items []struct {
		Metadata struct {
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
		} `json:"metadata"`
		Status struct {
			Phase      string `json:"phase"`
			Conditions []struct {
				Type   string `json:"type"`
				Status string `json:"status"`
			} `json:"conditions"`
		} `json:"status"`
		Type string `json:"type"`
	} `json:"items"`
}

func main() {
	apiURL := strings.TrimRight(strings.TrimSpace(os.Getenv("CLOUDSENTINELS_API_URL")), "/")
	token := strings.TrimSpace(os.Getenv("CLOUDSENTINELS_AGENT_TOKEN"))
	if apiURL == "" || token == "" || len(token) < 32 {
		log.Fatal("CLOUDSENTINELS_API_URL and a 32+ character CLOUDSENTINELS_AGENT_TOKEN are required")
	}
	parsed, err := url.Parse(apiURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && !(parsed.Scheme == "http" && (parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1"))) {
		log.Fatal("CLOUDSENTINELS_API_URL must use HTTPS (HTTP is allowed only for localhost)")
	}
	clusterID := env("CLOUDSENTINELS_AGENT_CLUSTER_ID", "minikube")
	ctxName := strings.TrimSpace(os.Getenv("CLOUDSENTINELS_AGENT_CONTEXT"))
	if ctxName == "" {
		ctxName, _ = kubectl(context.Background(), "config", "current-context")
		ctxName = strings.TrimSpace(ctxName)
	}
	if ctxName == "" {
		ctxName = clusterID
	}
	a := &agent{
		apiURL: apiURL, token: token, clusterID: clusterID, context: ctxName,
		allowMutations: strings.EqualFold(os.Getenv("CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS"), "true"),
		client:         &http.Client{Timeout: 15 * time.Second},
	}
	log.Printf("CloudSentinels desktop agent started; cluster=%s context=%s mutation_enabled=%t", a.clusterID, a.context, a.allowMutations)
	interval := 30 * time.Second
	if parsedInterval, err := time.ParseDuration(os.Getenv("CLOUDSENTINELS_AGENT_INTERVAL")); err == nil && parsedInterval >= 10*time.Second {
		interval = parsedInterval
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		a.collectAndSend()
		a.pollAndExecute()
		<-ticker.C
	}
}

func (a *agent) collectAndSend() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	nodesRaw, err := kubectl(ctx, "get", "nodes", "-o", "json")
	if err != nil {
		log.Printf("local cluster is not reachable; telemetry skipped: %v", err)
		return false
	}
	podsRaw, err := kubectl(ctx, "get", "pods", "-A", "-o", "json")
	if err != nil {
		log.Printf("could not read pods: %v", err)
		return false
	}
	eventsRaw, _ := kubectl(ctx, "get", "events", "-A", "--field-selector", "type=Warning", "-o", "json")
	var nodes, pods, events kubeList
	if json.Unmarshal([]byte(nodesRaw), &nodes) != nil || json.Unmarshal([]byte(podsRaw), &pods) != nil {
		log.Printf("kubectl returned an unexpected resource payload")
		return false
	}
	if eventsRaw != "" {
		_ = json.Unmarshal([]byte(eventsRaw), &events)
	}
	readyNodes, healthy := 0, 0
	for _, node := range nodes.Items {
		for _, condition := range node.Status.Conditions {
			if condition.Type == "Ready" && condition.Status == "True" {
				readyNodes++
			}
		}
	}
	for _, pod := range pods.Items {
		if strings.EqualFold(pod.Status.Phase, "Succeeded") {
			healthy++
			continue
		}
		if !strings.EqualFold(pod.Status.Phase, "Running") {
			continue
		}
		for _, condition := range pod.Status.Conditions {
			if condition.Type == "Ready" && condition.Status == "True" {
				healthy++
				break
			}
		}
	}
	cpu, memory := readNodeMetrics(ctx)
	payload := httpapi.LocalTelemetry{
		ClusterID: a.clusterID, Context: a.context, NodeCount: len(nodes.Items), ReadyNodeCount: readyNodes, PodCount: len(pods.Items),
		HealthyPodCount: healthy, WarningEvents: len(events.Items), CPUUsagePercent: cpu, MemoryUsageMB: memory,
		CollectedAt: time.Now().UTC(), Collector: "cloudsentinels-desktop-agent",
	}
	if err := a.post("/api/v1/agent/telemetry", payload, nil); err != nil {
		log.Printf("telemetry upload failed: %v", err)
		return false
	}
	log.Printf("telemetry sent: nodes=%d ready_nodes=%d pods=%d ready_pods=%d warning_events=%d cpu=%.1f%%", payload.NodeCount, payload.ReadyNodeCount, payload.PodCount, payload.HealthyPodCount, payload.WarningEvents, payload.CPUUsagePercent)
	return true
}

func (a *agent) pollAndExecute() {
	var response struct {
		Items []automation.Command `json:"items"`
	}
	path := "/api/v1/agent/commands?clusterId=" + url.QueryEscape(a.clusterID)
	if err := a.request("GET", path, nil, &response); err != nil {
		log.Printf("command poll failed: %v", err)
		return
	}
	for _, command := range response.Items {
		status, result := a.execute(command)
		var update struct {
			Status string `json:"status"`
			Result string `json:"result"`
		}
		update.Status, update.Result = status, result
		if err := a.post("/api/v1/agent/commands/"+url.PathEscape(command.ID)+"/result?clusterId="+url.QueryEscape(a.clusterID), update, nil); err != nil {
			log.Printf("could not report command %s result: %v", command.ID, err)
		}
	}
}

func (a *agent) execute(command automation.Command) (string, string) {
	if command.ClusterID != a.clusterID {
		return "blocked", "Command target does not match this agent's registered cluster."
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	switch command.Action {
	case "collect-snapshot":
		if !a.collectAndSend() {
			return "failed", "Kubernetes snapshot collection or telemetry upload failed."
		}
		return "succeeded", "Read-only Kubernetes snapshot and telemetry upload completed."
	case "rollout-status":
		if !safeResource.MatchString(command.Namespace) || !safeResource.MatchString(command.Deployment) {
			return "blocked", "Invalid Kubernetes namespace or deployment identifier."
		}
		out, err := kubectl(ctx, "rollout", "status", "deployment/"+command.Deployment, "-n", command.Namespace, "--timeout=60s")
		if err != nil {
			return "failed", truncate(err.Error()+" "+out, 3000)
		}
		return "succeeded", truncate(out, 3000)
	case "restart-deployment":
		if !a.allowMutations {
			return "blocked", "Local mutations are disabled. Set CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS=true only after reviewing the action policy."
		}
		if command.ApprovalStatus != "approved" || strings.TrimSpace(command.ApprovedBy) == "" {
			return "blocked", "A signed human approval is required."
		}
		if !safeResource.MatchString(command.Namespace) || !safeResource.MatchString(command.Deployment) {
			return "blocked", "Invalid Kubernetes namespace or deployment identifier."
		}
		out, err := kubectl(ctx, "rollout", "restart", "deployment/"+command.Deployment, "-n", command.Namespace)
		if err != nil {
			return "failed", truncate(err.Error()+" "+out, 3000)
		}
		verified, verifyErr := kubectl(ctx, "rollout", "status", "deployment/"+command.Deployment, "-n", command.Namespace, "--timeout=60s")
		if verifyErr != nil {
			return "failed", truncate("Restart was accepted but rollout verification failed: "+verifyErr.Error()+" "+verified, 3000)
		}
		return "succeeded", truncate(out+"\n"+verified, 3000)
	default:
		return "blocked", "Action is not in the local CLI allowlist; arbitrary shell commands are never accepted."
	}
}

func (a *agent) post(path string, payload any, output any) error {
	return a.request("POST", path, payload, output)
}

func (a *agent) request(method, path string, payload any, output any) error {
	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, a.apiURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+a.token)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("API returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	if output != nil {
		return json.NewDecoder(resp.Body).Decode(output)
	}
	return nil
}

func kubectl(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "kubectl", args...)
	output, err := cmd.CombinedOutput()
	return string(output), err
}

func readNodeMetrics(ctx context.Context) (float64, float64) {
	out, err := kubectl(ctx, "top", "nodes", "--no-headers")
	if err != nil {
		return 0, 0
	}
	var cpuTotal, memoryTotal float64
	count := 0
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		cpuPct, _ := strconv.ParseFloat(strings.TrimSuffix(fields[2], "%"), 64)
		mem := strings.TrimSuffix(fields[3], "Mi")
		memMB, _ := strconv.ParseFloat(mem, 64)
		cpuTotal += cpuPct
		memoryTotal += memMB
		count++
	}
	if count == 0 {
		return 0, 0
	}
	return cpuTotal / float64(count), memoryTotal
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
func truncate(v string, n int) string {
	if len(v) > n {
		return v[:n]
	}
	return v
}
