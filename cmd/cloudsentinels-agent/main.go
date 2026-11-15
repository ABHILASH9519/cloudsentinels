package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
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
	apiURL              string
	token               string
	clusterID           string
	context             string
	sourceType          string
	environment         string
	allowMutations      bool
	allowedNamespaces   map[string]bool
	lambdaTelemetryURL  string
	lambdaSigningSecret string
	client              *http.Client
}

type kubeList struct {
	Items []kubeItem `json:"items"`
}

type kubeItem struct {
	Metadata struct {
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
		UID       string `json:"uid"`
	} `json:"metadata"`
	Spec struct {
		Replicas *int32 `json:"replicas"`
	} `json:"spec"`
	Status struct {
		Phase         string `json:"phase"`
		ReadyReplicas int32  `json:"readyReplicas"`
		Conditions    []struct {
			Type               string `json:"type"`
			Status             string `json:"status"`
			LastTransitionTime string `json:"lastTransitionTime"`
		} `json:"conditions"`
	} `json:"status"`
	Type           string `json:"type"`
	Reason         string `json:"reason"`
	Message        string `json:"message"`
	FirstTimestamp string `json:"firstTimestamp"`
	LastTimestamp  string `json:"lastTimestamp"`
	EventTime      string `json:"eventTime"`
	InvolvedObject struct {
		Kind      string `json:"kind"`
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
	} `json:"involvedObject"`
}

func main() {
	apiURL := strings.TrimRight(strings.TrimSpace(os.Getenv("CLOUDSENTINELS_API_URL")), "/")
	token := strings.TrimSpace(os.Getenv("CLOUDSENTINELS_AGENT_TOKEN"))
	if apiURL == "" || token == "" || len(token) < 32 {
		log.Fatal("CLOUDSENTINELS_API_URL and a 32+ character CLOUDSENTINELS_AGENT_TOKEN are required")
	}
	if !allowedAgentAPIURL(apiURL, strings.EqualFold(os.Getenv("CLOUDSENTINELS_AGENT_ALLOW_INSECURE_INTERNAL_HTTP"), "true")) {
		log.Fatal("CLOUDSENTINELS_API_URL must use HTTPS (HTTP is allowed only for localhost or explicitly enabled in-cluster service DNS)")
	}
	clusterID := env("CLOUDSENTINELS_AGENT_CLUSTER_ID", "minikube")
	sourceType := env("CLOUDSENTINELS_AGENT_SOURCE_TYPE", "kubernetes-agent")
	environment := env("CLOUDSENTINELS_AGENT_ENVIRONMENT", "unknown")
	lambdaURL := strings.TrimRight(strings.TrimSpace(os.Getenv("CLOUDSENTINELS_LAMBDA_TELEMETRY_URL")), "/")
	lambdaSecret := strings.TrimSpace(os.Getenv("CLOUDSENTINELS_LAMBDA_SIGNING_SECRET"))
	if (lambdaURL == "") != (lambdaSecret == "") {
		log.Printf("Lambda event forwarding disabled: set both CLOUDSENTINELS_LAMBDA_TELEMETRY_URL and CLOUDSENTINELS_LAMBDA_SIGNING_SECRET")
		lambdaURL, lambdaSecret = "", ""
	}
	if lambdaURL != "" {
		lambdaParsed, parseErr := url.Parse(lambdaURL)
		if parseErr != nil || lambdaParsed.Scheme != "https" || lambdaParsed.Host == "" || len(lambdaSecret) < 32 {
			log.Fatal("Lambda telemetry URL must use HTTPS and signing secret must contain at least 32 characters")
		}
		if !strings.HasSuffix(lambdaURL, "/telemetry/events") {
			lambdaURL += "/telemetry/events"
		}
	}
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
		sourceType: sourceType, environment: environment,
		allowMutations:     strings.EqualFold(os.Getenv("CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS"), "true"),
		allowedNamespaces:  parseAllowedNamespaces(os.Getenv("CLOUDSENTINELS_AGENT_ALLOWED_NAMESPACES")),
		lambdaTelemetryURL: lambdaURL, lambdaSigningSecret: lambdaSecret,
		client: &http.Client{Timeout: 15 * time.Second},
	}
	log.Printf("CloudSentinels Kubernetes agent started; cluster=%s context=%s mutation_enabled=%t lambda_forwarding=%t", a.clusterID, a.context, a.allowMutations, a.lambdaTelemetryURL != "")
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
	deploymentsRaw, _ := kubectl(ctx, "get", "deployments", "-A", "-o", "json")
	var nodes, pods, events, deployments kubeList
	if json.Unmarshal([]byte(nodesRaw), &nodes) != nil || json.Unmarshal([]byte(podsRaw), &pods) != nil {
		log.Printf("kubectl returned an unexpected resource payload")
		return false
	}
	if eventsRaw != "" {
		_ = json.Unmarshal([]byte(eventsRaw), &events)
	}
	if deploymentsRaw != "" {
		_ = json.Unmarshal([]byte(deploymentsRaw), &deployments)
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
	recentWarnings := filterRecentWarnings(events.Items, time.Now().UTC(), 5*time.Minute)
	cpu, memory := readNodeMetrics(ctx)
	payload := httpapi.LocalTelemetry{
		ClusterID: a.clusterID, Context: a.context, SourceType: a.sourceType, Environment: a.environment,
		NodeCount: len(nodes.Items), ReadyNodeCount: readyNodes, PodCount: len(pods.Items),
		HealthyPodCount: healthy, WarningEvents: len(recentWarnings), CPUUsagePercent: cpu, MemoryUsageMB: memory,
		CollectedAt: time.Now().UTC(), Collector: "cloudsentinels-kubernetes-agent",
	}
	if err := a.post("/api/v1/agent/telemetry", payload, nil); err != nil {
		log.Printf("telemetry upload failed: %v", err)
		return false
	}
	log.Printf("telemetry sent: nodes=%d ready_nodes=%d pods=%d ready_pods=%d warning_events=%d cpu=%.1f%%", payload.NodeCount, payload.ReadyNodeCount, payload.PodCount, payload.HealthyPodCount, payload.WarningEvents, payload.CPUUsagePercent)
	a.forwardClusterSignals(nodes.Items, recentWarnings, deployments.Items, cpu)
	return true
}

func allowedAgentAPIURL(raw string, allowInternalHTTP bool) bool {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return false
	}
	if parsed.Scheme == "https" {
		return true
	}
	if parsed.Scheme != "http" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || host == "127.0.0.1" {
		return true
	}
	return allowInternalHTTP && strings.HasSuffix(host, ".svc.cluster.local")
}

func filterRecentWarnings(events []kubeItem, now time.Time, window time.Duration) []kubeItem {
	if window <= 0 {
		return nil
	}
	recent := make([]kubeItem, 0, len(events))
	for _, event := range events {
		if !strings.EqualFold(event.Type, "Warning") {
			continue
		}
		timestamp := event.LastTimestamp
		if timestamp == "" {
			timestamp = event.EventTime
		}
		if timestamp == "" {
			timestamp = event.FirstTimestamp
		}
		occurredAt, err := time.Parse(time.RFC3339Nano, timestamp)
		if err != nil {
			continue
		}
		age := now.Sub(occurredAt)
		if age >= 0 && age <= window {
			recent = append(recent, event)
		}
	}
	return recent
}

func mapKubernetesWarning(event kubeItem) (eventType, severity string, ok bool) {
	if !strings.EqualFold(event.Type, "Warning") {
		return "", "", false
	}
	reason := strings.ToLower(strings.TrimSpace(event.Reason))
	message := strings.ToLower(strings.TrimSpace(event.Message))
	kind := strings.ToLower(strings.TrimSpace(event.InvolvedObject.Kind))
	switch {
	case kind == "pod" && (strings.Contains(reason, "backoff") || strings.Contains(message, "crashloopbackoff") || strings.Contains(message, "back-off restarting failed container")):
		return "PodCrashLoopBackOff", "high", true
	case kind == "node" && (reason == "notready" || strings.Contains(message, "node not ready")):
		return "NodeNotReady", "critical", true
	case reason == "memorypressure" || strings.Contains(message, "memory pressure"):
		return "MemoryPressure", "high", true
	case kind == "deployment" && (reason == "failedcreate" || reason == "progressdeadlineexceeded" || reason == "unhealthy"):
		return "DeploymentUnhealthy", "high", true
	default:
		return "", "", false
	}
}

func stableEventID(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return "k8s-" + hex.EncodeToString(sum[:])
}

func lambdaEventSignature(secret, timestamp, clusterID string, raw []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp + "." + clusterID + "."))
	_, _ = mac.Write(raw)
	return hex.EncodeToString(mac.Sum(nil))
}

type lambdaClusterEvent struct {
	EventID      string `json:"eventId"`
	EventType    string `json:"eventType"`
	Severity     string `json:"severity"`
	Title        string `json:"title"`
	Message      string `json:"message"`
	Namespace    string `json:"namespace,omitempty"`
	ResourceKind string `json:"resourceKind,omitempty"`
	ResourceName string `json:"resourceName,omitempty"`
}

func (a *agent) forwardClusterSignals(nodes, events, deployments []kubeItem, cpuPercent float64) {
	for _, node := range nodes {
		for _, condition := range node.Status.Conditions {
			switch {
			case condition.Type == "Ready" && condition.Status != "True":
				id := stableEventID(a.clusterID, "node", node.Metadata.Name, condition.LastTransitionTime, condition.Status)
				a.postClusterEvent(lambdaClusterEvent{EventID: id, EventType: "NodeNotReady", Severity: "critical", Title: "Kubernetes node is not Ready", Message: "Node condition Ready=" + condition.Status, ResourceKind: "Node", ResourceName: node.Metadata.Name})
			case condition.Type == "MemoryPressure" && condition.Status == "True":
				id := stableEventID(a.clusterID, "memory", node.Metadata.Name, condition.LastTransitionTime)
				a.postClusterEvent(lambdaClusterEvent{EventID: id, EventType: "MemoryPressure", Severity: "high", Title: "Kubernetes node memory pressure", Message: "Node reports MemoryPressure=True", ResourceKind: "Node", ResourceName: node.Metadata.Name})
			}
		}
	}
	for _, event := range events {
		eventType, severity, ok := mapKubernetesWarning(event)
		if !ok {
			continue
		}
		eventTime := event.LastTimestamp
		if eventTime == "" {
			eventTime = event.FirstTimestamp
		}
		if eventTime == "" {
			eventTime = event.EventTime
		}
		id := stableEventID(a.clusterID, event.Metadata.UID, event.InvolvedObject.Kind, event.InvolvedObject.Namespace, event.InvolvedObject.Name, event.Reason, eventTime, event.Message)
		a.postClusterEvent(lambdaClusterEvent{
			EventID: id, EventType: eventType, Severity: severity,
			Title:   "Kubernetes " + eventType + ": " + event.InvolvedObject.Name,
			Message: event.Message, Namespace: event.InvolvedObject.Namespace,
			ResourceKind: event.InvolvedObject.Kind, ResourceName: event.InvolvedObject.Name,
		})
	}
	for _, deployment := range deployments {
		desired := int32(1)
		if deployment.Spec.Replicas != nil {
			desired = *deployment.Spec.Replicas
		}
		if desired == 0 || deployment.Status.ReadyReplicas >= desired {
			continue
		}
		transition := ""
		for _, condition := range deployment.Status.Conditions {
			if condition.LastTransitionTime > transition {
				transition = condition.LastTransitionTime
			}
		}
		id := stableEventID(a.clusterID, "deployment", deployment.Metadata.Namespace, deployment.Metadata.Name, transition, strconv.FormatInt(int64(deployment.Status.ReadyReplicas), 10), strconv.FormatInt(int64(desired), 10))
		a.postClusterEvent(lambdaClusterEvent{
			EventID: id, EventType: "DeploymentUnhealthy", Severity: "high",
			Title:     "Kubernetes deployment has unavailable replicas",
			Message:   fmt.Sprintf("Ready replicas %d of %d", deployment.Status.ReadyReplicas, desired),
			Namespace: deployment.Metadata.Namespace, ResourceKind: "Deployment", ResourceName: deployment.Metadata.Name,
		})
	}
	if cpuPercent >= 80 {
		bucket := strconv.FormatInt(time.Now().Unix()/300, 10)
		id := stableEventID(a.clusterID, "cpu-threshold", bucket)
		a.postClusterEvent(lambdaClusterEvent{
			EventID: id, EventType: "CpuThresholdExceeded", Severity: "high",
			Title:        "Kubernetes node CPU usage is high",
			Message:      fmt.Sprintf("Average node CPU usage is %.1f%% (threshold 80%%)", cpuPercent),
			ResourceKind: "Cluster", ResourceName: a.context,
		})
	}
}

func (a *agent) postClusterEvent(event lambdaClusterEvent) {
	payload := httpapi.AgentEvent{
		ClusterID: a.clusterID, ClusterName: a.context, EventID: event.EventID,
		EventType: event.EventType, Severity: event.Severity, Title: event.Title,
		Summary: event.Message, ResourceID: event.ResourceName, ResourceKind: event.ResourceKind,
		ResourceName: event.ResourceName, Namespace: event.Namespace, OccurredAt: time.Now().UTC(),
	}
	if err := a.post("/api/v1/agent/events", payload, nil); err != nil {
		log.Printf("cluster event upload failed: type=%s error=%v", event.EventType, err)
	}
	if a.lambdaTelemetryURL != "" {
		a.postLambdaEvent(event)
	}
}

func (a *agent) postLambdaEvent(event lambdaClusterEvent) {
	raw, err := json.Marshal(event)
	if err != nil {
		log.Printf("could not encode Lambda cluster event: %v", err)
		return
	}
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	req, err := http.NewRequest(http.MethodPost, a.lambdaTelemetryURL, bytes.NewReader(raw))
	if err != nil {
		log.Printf("could not create Lambda telemetry request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CS-Cluster-ID", a.clusterID)
	req.Header.Set("X-CS-Timestamp", timestamp)
	req.Header.Set("X-CS-Signature", lambdaEventSignature(a.lambdaSigningSecret, timestamp, a.clusterID, raw))
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("Lambda cluster event upload failed: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		log.Printf("Lambda cluster event rejected: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
		return
	}
	log.Printf("Lambda cluster event accepted: type=%s id=%s", event.EventType, event.EventID)
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
	case "restart-deployment", "rollback-deployment":
		if !a.allowMutations {
			return "blocked", "Local mutations are disabled. Set CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS=true only after reviewing the action policy."
		}
		if command.ApprovalStatus != "approved" || strings.TrimSpace(command.ApprovedBy) == "" {
			return "blocked", "A signed human approval is required."
		}
		if !safeResource.MatchString(command.Namespace) || !safeResource.MatchString(command.Deployment) {
			return "blocked", "Invalid Kubernetes namespace or deployment identifier."
		}
		if !a.allowedNamespaces[command.Namespace] {
			return "blocked", "Mutation target namespace is not in CLOUDSENTINELS_AGENT_ALLOWED_NAMESPACES."
		}
		var out string
		var err error
		if command.Action == "rollback-deployment" {
			out, err = kubectl(ctx, "rollout", "undo", "deployment/"+command.Deployment, "-n", command.Namespace)
		} else {
			out, err = kubectl(ctx, "rollout", "restart", "deployment/"+command.Deployment, "-n", command.Namespace)
		}
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

func parseAllowedNamespaces(raw string) map[string]bool {
	allowed := make(map[string]bool)
	for _, namespace := range strings.Split(raw, ",") {
		namespace = strings.TrimSpace(strings.ToLower(namespace))
		if namespace != "" && safeResource.MatchString(namespace) {
			allowed[namespace] = true
		}
	}
	if len(allowed) == 0 {
		allowed["cloudsentinels-system"] = true
	}
	return allowed
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
