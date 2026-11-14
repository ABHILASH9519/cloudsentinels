package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ABHILASH9519/cloudsentinels/internal/auth"
	"github.com/ABHILASH9519/cloudsentinels/internal/automation"
	"github.com/ABHILASH9519/cloudsentinels/internal/config"
	"github.com/ABHILASH9519/cloudsentinels/internal/httpapi"
	"github.com/ABHILASH9519/cloudsentinels/internal/inventory"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("load configuration", "error", err)
		os.Exit(1)
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	authenticator, err := auth.New(context.Background(), auth.Config{
		FirebaseProjectID: cfg.FirebaseProjectID, CredentialsFile: cfg.FirebaseCredentials, CredentialsJSON: cfg.FirebaseServiceAccountJSON,
		LocalToken: cfg.LocalAuthToken, Environment: cfg.Environment, AllowLocalToken: cfg.AllowLocalAuthInProd,
	})
	if err != nil {
		logger.Error("initialize authentication", "error", err)
		os.Exit(1)
	}

	var airtableClient *inventory.AirtableClient
	if cfg.AirtableToken != "" {
		airtableClient, err = inventory.NewAirtableClient(inventory.AirtableConfig{Token: cfg.AirtableToken, BaseID: cfg.AirtableBaseID})
		if err != nil {
			logger.Error("initialize Airtable client", "error", err)
			os.Exit(1)
		}
	}
	inventoryStore, err := inventory.NewStore(cfg.AirtableSnapshotPath, airtableClient)
	if err != nil {
		logger.Error("load sanitized Airtable snapshot", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if airtableClient != nil {
		refreshCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		if err := inventoryStore.Refresh(refreshCtx); err != nil {
			logger.Warn("initial Airtable refresh failed; serving last sanitized snapshot", "error", err)
		}
		cancel()
		inventoryStore.Start(ctx, cfg.AirtableSyncInterval, func(err error) { logger.Warn("scheduled Airtable refresh failed", "error", err) })
	}
	var dispatcher *automation.Dispatcher
	if cfg.ZapierCatchHookURL != "" {
		dispatcher = &automation.Dispatcher{URL: cfg.ZapierCatchHookURL, Secret: cfg.ZapierSigningSecret, Client: &http.Client{Timeout: 8 * time.Second}}
	}
	queue := automation.NewQueue()
	api := httpapi.NewServerWithServices(cfg, logger, authenticator, inventoryStore, queue, dispatcher)
	api.StartTelemetryMonitor(ctx, 30*time.Second)
	server := &http.Server{Addr: cfg.HTTPAddr, Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		logger.Info("CloudSentinels Go API starting", "address", cfg.HTTPAddr, "execution_mode", cfg.ExecutionMode,
			"inventory_source", inventoryStore.Snapshot().Source, "zapier_configured", dispatcher != nil, "n8n_configured", cfg.N8NWebhookURL != "" && cfg.N8NSigningSecret != "", "firebase_project_configured", cfg.FirebaseProjectID != "")
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("HTTP server failed", "error", err)
			stop()
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
}
