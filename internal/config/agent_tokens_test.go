package config

import "testing"

func TestLoadParsesPerClusterAgentCredentials(t *testing.T) {
	t.Setenv("CLOUDSENTINELS_AGENT_TOKEN", "")
	t.Setenv("CLOUDSENTINELS_AGENT_TOKENS", `{"prod-cluster-1":"0123456789abcdef0123456789abcdef","minikube":"abcdef0123456789abcdef0123456789"}`)
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.AgentTokens) != 2 || cfg.AgentTokens["prod-cluster-1"] == "" {
		t.Fatalf("unexpected per-cluster credentials: %#v", cfg.AgentTokens)
	}
}

func TestLoadRejectsWeakPerClusterAgentCredential(t *testing.T) {
	t.Setenv("CLOUDSENTINELS_AGENT_TOKENS", `{"prod-cluster-1":"short"}`)
	if _, err := Load(); err == nil {
		t.Fatal("expected weak per-cluster token to be rejected")
	}
}
