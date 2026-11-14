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

func TestLoadRequiresN8NSigningSecretAndLocalURL(t *testing.T) {
	t.Setenv("N8N_WEBHOOK_URL", "http://127.0.0.1:5678/webhook/cloudsentinels/events")
	t.Setenv("N8N_SIGNING_SECRET", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected n8n signing secret to be required")
	}
	t.Setenv("N8N_SIGNING_SECRET", "n8n-test-signing-secret-with-more-than-32-bytes")
	if _, err := Load(); err != nil {
		t.Fatalf("expected local n8n URL to be accepted: %v", err)
	}
	t.Setenv("N8N_WEBHOOK_URL", "http://remote.example.test/webhook/events")
	if _, err := Load(); err == nil {
		t.Fatal("expected non-local HTTP n8n URL to be rejected")
	}
}
