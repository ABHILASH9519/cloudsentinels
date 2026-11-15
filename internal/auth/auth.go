package auth

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"strings"

	firebase "firebase.google.com/go/v4"
	firebaseauth "firebase.google.com/go/v4/auth"
	"google.golang.org/api/option"
)

type Principal struct {
	Subject string   `json:"sub"`
	Roles   []string `json:"roles,omitempty"`
	Email   string   `json:"email,omitempty"`
}

type Config struct {
	FirebaseProjectID string
	CredentialsFile   string
	CredentialsJSON   string
	LocalToken        string
	Environment       string
	AllowLocalToken   bool
}

type Authenticator interface {
	Authenticate(*http.Request) (Principal, error)
}

type authenticator struct {
	firebaseClient *firebaseauth.Client
	localToken     []byte
}

func New(ctx context.Context, cfg Config) (Authenticator, error) {
	a := &authenticator{}
	projectID := strings.TrimSpace(cfg.FirebaseProjectID)
	credentialsFile := strings.TrimSpace(cfg.CredentialsFile)
	credentialsJSON := strings.TrimSpace(cfg.CredentialsJSON)
	if credentialsFile != "" && credentialsJSON != "" {
		return nil, errors.New("configure only one of GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON")
	}
	if (credentialsFile != "" || credentialsJSON != "") && projectID == "" {
		return nil, errors.New("FIREBASE_PROJECT_ID is required when Firebase service-account credentials are configured")
	}
	if projectID != "" {
		firebaseConfig := &firebase.Config{ProjectID: projectID}
		var options []option.ClientOption
		if credentialsFile != "" {
			options = append(options, option.WithCredentialsFile(credentialsFile))
		} else if credentialsJSON != "" {
			options = append(options, option.WithCredentialsJSON([]byte(credentialsJSON)))
		}
		app, err := firebase.NewApp(ctx, firebaseConfig, options...)
		if err != nil {
			return nil, fmt.Errorf("initialize Firebase Admin SDK: %w", err)
		}
		client, err := app.Auth(ctx)
		if err != nil {
			return nil, fmt.Errorf("initialize Firebase Authentication client: %w", err)
		}
		a.firebaseClient = client
	}

	localToken := strings.TrimSpace(cfg.LocalToken)
	if localToken != "" {
		if len(localToken) < 32 {
			return nil, errors.New("local auth token must contain at least 32 characters")
		}
		if strings.EqualFold(cfg.Environment, "production") && !cfg.AllowLocalToken {
			return nil, errors.New("local auth token is disabled in production unless explicitly allowed")
		}
		a.localToken = []byte(localToken)
	}
	if a.firebaseClient == nil && len(a.localToken) == 0 {
		return nil, nil
	}
	return a, nil
}

func (a *authenticator) Authenticate(r *http.Request) (Principal, error) {
	if a == nil {
		return Principal{}, errors.New("authentication is not configured")
	}
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if !strings.HasPrefix(strings.ToLower(header), "bearer ") {
		return Principal{}, errors.New("missing bearer token")
	}
	raw := strings.TrimSpace(header[len("Bearer "):])
	if raw == "" {
		return Principal{}, errors.New("empty bearer token")
	}
	if len(a.localToken) > 0 && len(raw) == len(a.localToken) &&
		subtle.ConstantTimeCompare([]byte(raw), a.localToken) == 1 {
		return Principal{Subject: "local-operator", Roles: []string{"operator", "admin"}}, nil
	}
	if a.firebaseClient == nil {
		return Principal{}, errors.New("token did not match configured local credentials")
	}
	token, err := a.firebaseClient.VerifyIDTokenAndCheckRevoked(r.Context(), raw)
	if err != nil {
		return Principal{}, fmt.Errorf("verify Firebase ID token: %w", err)
	}
	email, _ := token.Claims["email"].(string)
	roles := []string{}
	if rawRoles, ok := token.Claims["roles"].([]any); ok {
		for _, role := range rawRoles {
			if value, ok := role.(string); ok && strings.TrimSpace(value) != "" {
				roles = append(roles, value)
			}
		}
	}
	return Principal{Subject: token.UID, Email: email, Roles: roles}, nil
}
