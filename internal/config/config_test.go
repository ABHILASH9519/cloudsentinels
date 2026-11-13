package config

import "testing"

func TestLoadDefaultsToDevelopmentServer(t *testing.T) {
	t.Setenv("CLOUDSENTINELS_HTTP_ADDR", "")
	t.Setenv("CLOUDSENTINELS_EXECUTION_MODE", "")
	t.Setenv("CLOUDSENTINELS_ENV", "")
	t.Setenv("CLOUDSENTINELS_VERSION", "")
	t.Setenv("COGNITO_ISSUER_URL", "")
	t.Setenv("COGNITO_APP_CLIENT_ID", "")
	t.Setenv("CLOUDSENTINELS_LOCAL_AUTH_TOKEN", "")
	t.Setenv("CLOUDSENTINELS_ALLOW_LOCAL_AUTH_IN_PROD", "")
	t.Setenv("CLOUDSENTINELS_ALLOWED_ORIGINS", "")
	t.Setenv("AIRTABLE_API_TOKEN", "")
	t.Setenv("AIRTABLE_BASE_ID", "")
	t.Setenv("AIRTABLE_SNAPSHOT_PATH", "")
	t.Setenv("AIRTABLE_SYNC_INTERVAL", "")
	t.Setenv("ZAPIER_CATCH_HOOK_URL", "")
	t.Setenv("ZAPIER_SIGNING_SECRET", "")
	t.Setenv("CLOUDSENTINELS_AGENT_TOKEN", "")
	t.Setenv("CLOUDSENTINELS_AGENT_TOKENS", "")
	t.Setenv("CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS", "")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ExecutionMode != "online-server" || cfg.Environment != "development" || cfg.HTTPAddr != ":8080" {
		t.Fatalf("unexpected defaults: %#v", cfg)
	}
}

func TestLoadRejectsPartialCognitoConfig(t *testing.T) {
	t.Setenv("COGNITO_ISSUER_URL", "https://issuer.example")
	t.Setenv("COGNITO_APP_CLIENT_ID", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected partial Cognito config to fail")
	}
}

func TestLoadRejectsLocalAuthInProduction(t *testing.T) {
	t.Setenv("CLOUDSENTINELS_ENV", "production")
	t.Setenv("CLOUDSENTINELS_LOCAL_AUTH_TOKEN", "a sufficiently long test token value")
	t.Setenv("CLOUDSENTINELS_ALLOW_LOCAL_AUTH_IN_PROD", "false")
	if _, err := Load(); err == nil {
		t.Fatal("expected local auth to be rejected in production")
	}
}

func TestLoadAcceptsSupportedExecutionModes(t *testing.T) {
	for _, mode := range []string{"online-server", "online-serverless", "offline-kubernetes"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("CLOUDSENTINELS_EXECUTION_MODE", mode)
			if _, err := Load(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
