package config

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	HTTPAddr      string
	ExecutionMode string
	Environment   string
	BuildVersion  string
}

func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:      env("CLOUDSENTINELS_HTTP_ADDR", ":8080"),
		ExecutionMode: strings.ToLower(env("CLOUDSENTINELS_EXECUTION_MODE", "online-server")),
		Environment:   strings.ToLower(env("CLOUDSENTINELS_ENV", "development")),
		BuildVersion:  env("CLOUDSENTINELS_VERSION", "dev"),
	}
	switch cfg.ExecutionMode {
	case "online-server", "online-serverless", "offline-kubernetes":
	default:
		return Config{}, fmt.Errorf("unsupported CLOUDSENTINELS_EXECUTION_MODE %q", cfg.ExecutionMode)
	}
	if cfg.HTTPAddr == "" {
		return Config{}, fmt.Errorf("CLOUDSENTINELS_HTTP_ADDR cannot be empty")
	}
	return cfg, nil
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
