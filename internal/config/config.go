package config

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr             string
	ExecutionMode        string
	Environment          string
	BuildVersion         string
	FirebaseProjectID    string
	FirebaseCredentials  string
	LocalAuthToken       string
	AllowLocalAuthInProd bool
	AllowedOrigins       []string
	AirtableToken        string
	AirtableBaseID       string
	AirtableSnapshotPath string
	AirtableSyncInterval time.Duration
	ZapierCatchHookURL   string
	ZapierSigningSecret  string
	N8NWebhookURL        string
	N8NSigningSecret     string
	AgentToken           string
	AgentTokens          map[string]string
	AllowLocalMutations  bool
}

func Load() (Config, error) {
	agentTokens, err := parseAgentTokens(os.Getenv("CLOUDSENTINELS_AGENT_TOKENS"))
	if err != nil {
		return Config{}, err
	}
	cfg := Config{
		HTTPAddr:             env("CLOUDSENTINELS_HTTP_ADDR", ":8080"),
		ExecutionMode:        strings.ToLower(env("CLOUDSENTINELS_EXECUTION_MODE", "online-server")),
		Environment:          strings.ToLower(env("CLOUDSENTINELS_ENV", "development")),
		BuildVersion:         env("CLOUDSENTINELS_VERSION", "dev"),
		FirebaseProjectID:    env("FIREBASE_PROJECT_ID", ""),
		FirebaseCredentials:  env("GOOGLE_APPLICATION_CREDENTIALS", ""),
		LocalAuthToken:       env("CLOUDSENTINELS_LOCAL_AUTH_TOKEN", ""),
		AllowLocalAuthInProd: boolEnv("CLOUDSENTINELS_ALLOW_LOCAL_AUTH_IN_PROD"),
		AllowedOrigins:       splitList(env("CLOUDSENTINELS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")),
		AirtableToken:        env("AIRTABLE_API_TOKEN", ""),
		AirtableBaseID:       env("AIRTABLE_BASE_ID", "app3xn3iXAsm7MgA7"),
		AirtableSnapshotPath: env("AIRTABLE_SNAPSHOT_PATH", "deploy/eks/airtable-inventory.snapshot.json"),
		AirtableSyncInterval: durationEnv("AIRTABLE_SYNC_INTERVAL", 5*time.Minute),
		ZapierCatchHookURL:   env("ZAPIER_CATCH_HOOK_URL", ""),
		ZapierSigningSecret:  env("ZAPIER_SIGNING_SECRET", ""),
		N8NWebhookURL:        env("N8N_WEBHOOK_URL", ""),
		N8NSigningSecret:     env("N8N_SIGNING_SECRET", ""),
		AgentToken:           env("CLOUDSENTINELS_AGENT_TOKEN", ""),
		AgentTokens:          agentTokens,
		AllowLocalMutations:  boolEnv("CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS"),
	}
	switch cfg.ExecutionMode {
	case "online-server", "online-serverless", "offline-kubernetes":
	default:
		return Config{}, fmt.Errorf("unsupported CLOUDSENTINELS_EXECUTION_MODE %q", cfg.ExecutionMode)
	}
	if cfg.HTTPAddr == "" {
		return Config{}, fmt.Errorf("CLOUDSENTINELS_HTTP_ADDR cannot be empty")
	}
	if cfg.FirebaseCredentials != "" && cfg.FirebaseProjectID == "" {
		return Config{}, fmt.Errorf("FIREBASE_PROJECT_ID is required with GOOGLE_APPLICATION_CREDENTIALS")
	}
	if cfg.Environment == "production" && cfg.LocalAuthToken != "" && !cfg.AllowLocalAuthInProd {
		return Config{}, fmt.Errorf("local authentication is disabled in production")
	}
	if cfg.AgentToken != "" && len(cfg.AgentToken) < 32 {
		return Config{}, fmt.Errorf("CLOUDSENTINELS_AGENT_TOKEN must be at least 32 characters")
	}
	if cfg.ZapierSigningSecret != "" && len(cfg.ZapierSigningSecret) < 32 {
		return Config{}, fmt.Errorf("ZAPIER_SIGNING_SECRET must be at least 32 characters")
	}
	if cfg.N8NSigningSecret != "" && len(cfg.N8NSigningSecret) < 32 {
		return Config{}, fmt.Errorf("N8N_SIGNING_SECRET must be at least 32 characters")
	}
	if cfg.N8NWebhookURL != "" {
		u, err := url.ParseRequestURI(cfg.N8NWebhookURL)
		if err != nil || u.Host == "" || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"))) {
			return Config{}, fmt.Errorf("N8N_WEBHOOK_URL must be HTTPS or local HTTP")
		}
		if cfg.N8NSigningSecret == "" {
			return Config{}, fmt.Errorf("N8N_SIGNING_SECRET is required when N8N_WEBHOOK_URL is configured")
		}
	}
	if cfg.ZapierCatchHookURL != "" {
		u, err := url.ParseRequestURI(cfg.ZapierCatchHookURL)
		if err != nil || u.Scheme != "https" || u.Host == "" {
			return Config{}, fmt.Errorf("ZAPIER_CATCH_HOOK_URL must be a valid HTTPS URL")
		}
		if cfg.ZapierSigningSecret == "" {
			return Config{}, fmt.Errorf("ZAPIER_SIGNING_SECRET is required when a Zapier Catch Hook URL is configured")
		}
	}
	return cfg, nil
}

func parseAgentTokens(raw string) (map[string]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var tokens map[string]string
	if err := json.Unmarshal([]byte(raw), &tokens); err != nil {
		return nil, fmt.Errorf("CLOUDSENTINELS_AGENT_TOKENS must be a JSON object keyed by cluster ID")
	}
	for clusterID, token := range tokens {
		if strings.TrimSpace(clusterID) == "" || len(clusterID) > 128 || len(strings.TrimSpace(token)) < 32 {
			return nil, fmt.Errorf("each CLOUDSENTINELS_AGENT_TOKENS entry needs a cluster ID and a 32+ character token")
		}
		tokens[clusterID] = strings.TrimSpace(token)
	}
	return tokens, nil
}
func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
func boolEnv(key string) bool { v, _ := strconv.ParseBool(strings.TrimSpace(os.Getenv(key))); return v }
func durationEnv(key string, fallback time.Duration) time.Duration {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil || d < time.Minute {
		return fallback
	}
	return d
}
func splitList(value string) []string {
	var items []string
	for _, item := range strings.Split(value, ",") {
		if v := strings.TrimSpace(item); v != "" {
			items = append(items, v)
		}
	}
	return items
}
