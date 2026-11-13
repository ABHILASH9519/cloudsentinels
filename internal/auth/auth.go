package auth

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

type Principal struct {
	Subject string   `json:"sub"`
	Roles   []string `json:"roles,omitempty"`
	Email   string   `json:"email,omitempty"`
}

type Config struct {
	IssuerURL       string
	ClientID        string
	LocalToken      string
	Environment     string
	AllowLocalToken bool
}

type Authenticator interface {
	Authenticate(*http.Request) (Principal, error)
}

type authenticator struct {
	verifier   *oidc.IDTokenVerifier
	localToken []byte
}

func New(ctx context.Context, cfg Config) (Authenticator, error) {
	issuer := strings.TrimSpace(cfg.IssuerURL)
	clientID := strings.TrimSpace(cfg.ClientID)
	if (issuer == "") != (clientID == "") {
		return nil, errors.New("Cognito issuer URL and app client ID must be configured together")
	}

	a := &authenticator{}
	if issuer != "" {
		parsedIssuer, err := url.ParseRequestURI(issuer)
		if err != nil || parsedIssuer.Scheme != "https" || parsedIssuer.Host == "" {
			return nil, errors.New("Cognito issuer URL must be a valid HTTPS URL")
		}
		discoveryCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		defer cancel()
		provider, err := oidc.NewProvider(discoveryCtx, issuer)
		if err != nil {
			return nil, fmt.Errorf("initialize Cognito OIDC provider: %w", err)
		}
		a.verifier = provider.Verifier(&oidc.Config{ClientID: clientID})
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
	if a.verifier == nil && len(a.localToken) == 0 {
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
	if a.verifier == nil {
		return Principal{}, errors.New("token did not match configured local credentials")
	}

	token, err := a.verifier.Verify(r.Context(), raw)
	if err != nil {
		return Principal{}, fmt.Errorf("verify Cognito ID token: %w", err)
	}
	var claims struct {
		Subject     string   `json:"sub"`
		Email       string   `json:"email"`
		TokenUse    string   `json:"token_use"`
		Groups      []string `json:"cognito:groups"`
		LegacyGroup []string `json:"groups"`
	}
	if err := token.Claims(&claims); err != nil {
		return Principal{}, fmt.Errorf("decode Cognito claims: %w", err)
	}
	if claims.Subject == "" || (claims.TokenUse != "" && claims.TokenUse != "id") {
		return Principal{}, errors.New("token is not a valid Cognito ID-token identity")
	}
	roles := claims.Groups
	if len(roles) == 0 {
		roles = claims.LegacyGroup
	}
	return Principal{Subject: claims.Subject, Email: claims.Email, Roles: roles}, nil
}
