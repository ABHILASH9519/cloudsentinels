package config

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	HTTPAddr             string
	ExecutionMode        string
	Environment          string
	BuildVersion         string
	CognitoIssuerURL     string
	CognitoClientID      string
	LocalAuthToken       string
	AllowLocalAuthInProd bool
}

func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:             env("CLOUDSENTINELS_HTTP_ADDR", ":8080"),
		ExecutionMode:        strings.ToLower(env("CLOUDSENTINELS_EXECUTION_MODE", "online-server")),
		Environment:          strings.ToLower(env("CLOUDSENTINELS_ENV", "development")),
		BuildVersion:         env("CLOUDSENTINELS_VERSION", "dev"),
		CognitoIssuerURL:     env("COGNITO_ISSUER_URL", ""),
		CognitoClientID:      env("COGNITO_APP_CLIENT_ID", ""),
		LocalAuthToken:       env("CLOUDSENTINELS_LOCAL_AUTH_TOKEN", ""),
		AllowLocalAuthInProd: strings.EqualFold(env("CLOUDSENTINELS_ALLOW_LOCAL_AUTH_IN_PROD", "false"), "true"),
	}
	switch cfg.ExecutionMode {
	case "online-server", "online-serverless", "offline-kubernetes":
	default:
		return Config{}, fmt.Errorf("unsupported CLOUDSENTINELS_EXECUTION_MODE %q", cfg.ExecutionMode)
	}
	if cfg.HTTPAddr == "" {
		return Config{}, fmt.Errorf("CLOUDSENTINELS_HTTP_ADDR cannot be empty")
	}
	if (cfg.CognitoIssuerURL == "") != (cfg.CognitoClientID == "") {
		return Config{}, fmt.Errorf("COGNITO_ISSUER_URL and COGNITO_APP_CLIENT_ID must be configured together")
	}
	if cfg.Environment == "production" && cfg.LocalAuthToken != "" && !cfg.AllowLocalAuthInProd {
		return Config{}, fmt.Errorf("local authentication is disabled in production")
	}
	return cfg, nil
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
