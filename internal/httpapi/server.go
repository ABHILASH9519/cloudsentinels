package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/ABHILASH9519/cloudsentinels/internal/auth"
	"github.com/ABHILASH9519/cloudsentinels/internal/config"
	"github.com/ABHILASH9519/cloudsentinels/internal/domain"
)

type Authenticator interface {
	Authenticate(*http.Request) (auth.Principal, error)
}

type Server struct {
	config        config.Config
	logger        *slog.Logger
	authenticator Authenticator
	mu            sync.RWMutex
	incidents     map[string]domain.Incident
}

func NewServer(cfg config.Config, logger *slog.Logger, authenticator Authenticator) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	return &Server{config: cfg, logger: logger, authenticator: authenticator, incidents: make(map[string]domain.Incident)}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /readyz", s.ready)
	mux.HandleFunc("GET /api/v1/platform", s.platform)
	mux.HandleFunc("GET /api/v1/incidents", s.listIncidents)
	mux.HandleFunc("POST /api/v1/incidents", s.createIncident)
	return s.requestLogger(securityHeaders(mux))
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "cloudsentinels"})
}

func (s *Server) ready(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready", "executionMode": s.config.ExecutionMode})
}

func (s *Server) platform(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"service":       "cloudsentinels",
		"version":       s.config.BuildVersion,
		"executionMode": s.config.ExecutionMode,
		"components": []map[string]string{
			{"id": "online-server", "status": "adapter-pending"},
			{"id": "online-serverless", "status": "adapter-pending"},
			{"id": "offline-kubernetes", "status": "adapter-pending"},
		},
		"core": map[string]string{
			"incidentDetection": "go-api-bootstrap",
			"aiAnalysis":        "provider-adapter-pending",
			"remediation":       "policy-engine-pending",
		},
	})
}

func (s *Server) listIncidents(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]domain.Incident, 0, len(s.incidents))
	for _, item := range s.incidents {
		items = append(items, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "count": len(items), "storage": "process-memory-demo"})
}

func (s *Server) createIncident(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var item domain.Incident
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&item); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body is not valid incident JSON")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body must contain exactly one JSON object")
		return
	}
	if item.Status == "" {
		item.Status = domain.StatusOpen
	}
	if err := item.Validate(); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_incident", err.Error())
		return
	}
	if item.ID == "" {
		id, err := newID()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "id_generation_failed", "Could not generate an incident identifier")
			return
		}
		item.ID = id
	}
	if item.DetectedAt.IsZero() {
		item.DetectedAt = time.Now().UTC()
	}
	s.mu.Lock()
	if _, exists := s.incidents[item.ID]; exists {
		s.mu.Unlock()
		writeError(w, http.StatusConflict, "incident_exists", "An incident with this identifier already exists")
		return
	}
	s.incidents[item.ID] = item
	s.mu.Unlock()
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) authorize(w http.ResponseWriter, r *http.Request) bool {
	if s.authenticator == nil {
		writeError(w, http.StatusServiceUnavailable, "authentication_unconfigured", "Protected API routes are disabled until an AWS Cognito or local-session authenticator is configured")
		return false
	}
	if _, err := s.authenticator.Authenticate(r); err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "A valid authenticated session is required")
		return false
	}
	return true
}

func (s *Server) requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		s.logger.Info("http request", "method", r.Method, "path", r.URL.Path, "duration", time.Since(start).String())
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		if origin := r.Header.Get("Origin"); origin != "" && strings.HasPrefix(origin, "https://") {
			w.Header().Set("Vary", "Origin")
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": code, "message": message})
}

func newID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(value[:]), nil
}
