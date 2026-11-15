package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNewRejectsCredentialsWithoutFirebaseProjectID(t *testing.T) {
	_, err := New(context.Background(), Config{CredentialsFile: `C:\firebase\service-account.json`})
	if err == nil {
		t.Fatal("expected Firebase credentials without project ID to fail")
	}
}

func TestNewRejectsShortLocalToken(t *testing.T) {
	_, err := New(context.Background(), Config{LocalToken: "too-short", Environment: "development"})
	if err == nil {
		t.Fatal("expected short local token to fail")
	}
}

func TestLocalTokenIsDisabledInProductionByDefault(t *testing.T) {
	_, err := New(context.Background(), Config{LocalToken: strings.Repeat("a", 40), Environment: "production"})
	if err == nil {
		t.Fatal("expected local token to be rejected in production")
	}
}

func TestLocalTokenAuthenticatesAndRejectsWrongToken(t *testing.T) {
	secret := strings.Repeat("s", 48)
	authenticator, err := New(context.Background(), Config{LocalToken: secret, Environment: "development"})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("Authorization", "Bearer "+secret)
	principal, err := authenticator.Authenticate(request)
	if err != nil {
		t.Fatal(err)
	}
	if principal.Subject != "local-operator" || len(principal.Roles) != 2 {
		t.Fatalf("unexpected principal: %#v", principal)
	}
	request.Header.Set("Authorization", "Bearer "+strings.Repeat("x", len(secret)))
	if _, err := authenticator.Authenticate(request); err == nil {
		t.Fatal("expected invalid token to be rejected")
	}
}

func TestMissingBearerTokenRejected(t *testing.T) {
	authenticator, err := New(context.Background(), Config{LocalToken: strings.Repeat("s", 48)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authenticator.Authenticate(httptest.NewRequest(http.MethodGet, "/", nil)); err == nil {
		t.Fatal("expected missing bearer token to be rejected")
	}
}
