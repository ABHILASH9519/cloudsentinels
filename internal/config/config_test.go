package config

import "testing"

func TestLoadDefaultsToDevelopmentServer(t *testing.T) {
	for _, key := range []string{
		"CLOUDSENTINELS_HTTP_ADDR", "CLOUDSENTINELS_EXECUTION_MODE", "CLOUDSENTINELS_ENV",
		"CLOUDSENTINELS_VERSION", "FIREBASE_PROJECT_ID", "GOOGLE_APPLICATION_CREDENTIALS",
		"CLOUDSENTINELS_LOCAL_AUTH_TOKEN", "CLOUDSENTINELS_ALLOW_LOCAL_AUTH_IN_PROD",
		"CLOUDSENTINELS_ALLOWED_ORIGINS", "AIRTABLE_API_TOKEN", "AIRTABLE_BASE_ID",
		"AIRTABLE_SNAPSHOT_PATH", "AIRTABLE_SYNC_INTERVAL", "ZAPIER_CATCH_HOOK_URL",
		"ZAPIER_SIGNING_SECRET", "CLOUDSENTINELS_AGENT_TOKEN", "CLOUDSENTINELS_AGENT_TOKENS",
		"CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS",
	} {
		t.Setenv(key, "")
	}
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ExecutionMode != "online-server" || cfg.Environment != "development" || cfg.HTTPAddr != ":8080" {
		t.Fatalf("unexpected defaults: %#v", cfg)
	}
}

func TestLoadRequiresFirebaseProjectIDForServiceAccount(t *testing.T) {
	t.Setenv("FIREBASE_PROJECT_ID", "")
	t.Setenv("GOOGLE_APPLICATION_CREDENTIALS", "C:\\firebase\\service-account.json")
	if _, err := Load(); err == nil {
		t.Fatal("expected Firebase project ID to be required")
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
			t.Setenv("GOOGLE_APPLICATION_CREDENTIALS", "")
			if _, err := Load(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestLoadFirebaseProjectFallbackAndServiceAccountJSON(t *testing.T) {
	t.Setenv("FIREBASE_PROJECT_ID", "")
	t.Setenv("GOOGLE_CLOUD_PROJECT", "cloudsentinels-test")
	t.Setenv("GOOGLE_APPLICATION_CREDENTIALS", "")
	t.Setenv("FIREBASE_SERVICE_ACCOUNT_JSON", `{"type":"service_account","project_id":"cloudsentinels-test"}`)
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.FirebaseProjectID != "cloudsentinels-test" || cfg.FirebaseServiceAccountJSON == "" {
		t.Fatalf("Firebase config not loaded: %#v", cfg)
	}
}

func TestLoadRejectsConflictingOrInvalidFirebaseCredentials(t *testing.T) {
	t.Setenv("FIREBASE_PROJECT_ID", "cloudsentinels-test")
	t.Setenv("GOOGLE_CLOUD_PROJECT", "")
	t.Setenv("GOOGLE_APPLICATION_CREDENTIALS", `C:\firebase\service-account.json`)
	t.Setenv("FIREBASE_SERVICE_ACCOUNT_JSON", `{}`)
	if _, err := Load(); err == nil {
		t.Fatal("expected conflicting credential sources to be rejected")
	}
	t.Setenv("GOOGLE_APPLICATION_CREDENTIALS", "")
	t.Setenv("FIREBASE_SERVICE_ACCOUNT_JSON", "not-json")
	if _, err := Load(); err == nil {
		t.Fatal("expected invalid Firebase service account JSON to be rejected")
	}
}
