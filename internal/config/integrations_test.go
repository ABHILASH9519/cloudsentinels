package config

import "testing"

func TestLoadRejectsInsecureZapierURL(t *testing.T) {
	t.Setenv("ZAPIER_CATCH_HOOK_URL", "http://hooks.example.test")
	t.Setenv("ZAPIER_SIGNING_SECRET", "a-zapier-secret-with-more-than-32-characters")
	if _, err := Load(); err == nil {
		t.Fatal("expected insecure Zapier URL to be rejected")
	}
}

func TestLoadRequiresStrongAgentAndWebhookSecrets(t *testing.T) {
	t.Setenv("CLOUDSENTINELS_AGENT_TOKEN", "short")
	if _, err := Load(); err == nil {
		t.Fatal("expected short agent token to be rejected")
	}
	t.Setenv("CLOUDSENTINELS_AGENT_TOKEN", "agent-token-with-at-least-32-characters")
	t.Setenv("ZAPIER_SIGNING_SECRET", "short")
	if _, err := Load(); err == nil {
		t.Fatal("expected short Zapier secret to be rejected")
	}
}
