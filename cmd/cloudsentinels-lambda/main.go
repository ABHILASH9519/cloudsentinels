package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/ABHILASH9519/cloudsentinels/internal/auth"
	"github.com/ABHILASH9519/cloudsentinels/internal/automation"
	"github.com/ABHILASH9519/cloudsentinels/internal/config"
	"github.com/ABHILASH9519/cloudsentinels/internal/httpapi"
	"github.com/ABHILASH9519/cloudsentinels/internal/inventory"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/awslabs/aws-lambda-go-api-proxy/httpadapter"
)

var adapter *httpadapter.HandlerAdapterV2

func init() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("load Lambda configuration", "error", err)
		os.Exit(1)
	}
	cfg.ExecutionMode = "online-serverless"
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	authenticator, err := auth.New(context.Background(), auth.Config{
		FirebaseProjectID: cfg.FirebaseProjectID, CredentialsFile: cfg.FirebaseCredentials, CredentialsJSON: cfg.FirebaseServiceAccountJSON,
		LocalToken: cfg.LocalAuthToken, Environment: cfg.Environment, AllowLocalToken: cfg.AllowLocalAuthInProd,
	})
	if err != nil {
		logger.Error("initialize Firebase Authentication", "error", err)
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
	store, err := inventory.NewStore(cfg.AirtableSnapshotPath, airtableClient)
	if err != nil {
		logger.Error("load Airtable inventory snapshot", "error", err)
		os.Exit(1)
	}
	if airtableClient != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		if err := store.Refresh(ctx); err != nil {
			logger.Warn("initial Airtable refresh failed; using bundled snapshot", "error", err)
		}
		cancel()
	}
	var dispatcher *automation.Dispatcher
	if cfg.ZapierCatchHookURL != "" {
		dispatcher = &automation.Dispatcher{URL: cfg.ZapierCatchHookURL, Secret: cfg.ZapierSigningSecret, Client: &http.Client{Timeout: 8 * time.Second}}
	}
	api := httpapi.NewServerWithServices(cfg, logger, authenticator, store, automation.NewQueue(), dispatcher)
	adapter = httpadapter.NewV2(api.Handler())
	logger.Info("CloudSentinels Lambda adapter initialized", "execution_mode", cfg.ExecutionMode, "inventory_source", store.Snapshot().Source, "zapier_configured", dispatcher != nil)
}

func main() {
	if adapter == nil {
		slog.Error("Lambda HTTP adapter failed to initialize")
		os.Exit(1)
	}
	lambda.Start(adapter.ProxyWithContext)
}
