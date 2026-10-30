#!/usr/bin/env bash
set -euo pipefail

ADMIN_IDENTITY="cloudsentinels-ci-admin"
USER_IDENTITY="cloudsentinels-ci-user"
ADMIN_TOKEN="ci-only-cloudsentinels-bootstrap-token"
TMP_DIR="$(mktemp -d)"

cleanup() {
  icp network stop >/dev/null 2>&1 || true
  icp identity delete "$ADMIN_IDENTITY" >/dev/null 2>&1 || true
  icp identity delete "$USER_IDENTITY" >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# Create both identities before starting the local network so the local proxy
# recognizes them. Plaintext storage is limited to this disposable CI runner.
icp identity new "$ADMIN_IDENTITY" --storage plaintext >/dev/null 2>&1
icp identity new "$USER_IDENTITY" --storage plaintext >/dev/null 2>&1
icp identity default "$ADMIN_IDENTITY"

icp network start -d
icp deploy backend

# Configure a test-only canister runtime secret, then exercise the same
# registration method called by the authenticated frontend actor.
icp canister settings update backend --add-environment-variable "CLOUDSENTINELS_ADMIN_TOKEN=$ADMIN_TOKEN"
icp canister call backend _initializeAccessControlWithSecret "(\"$ADMIN_TOKEN\")"
ADMIN_ROLE="$(icp canister call backend getCallerUserRole)"
[[ "$ADMIN_ROLE" == *admin* ]] || { echo "First authenticated caller was not made admin"; exit 1; }

# Profile CRUD.
icp canister call backend saveCallerUserProfile '(record { name = "CI Admin" })'
PROFILE="$(icp canister call backend getCallerUserProfile)"
[[ "$PROFILE" == *"CI Admin"* ]] || { echo "Profile round-trip failed"; exit 1; }

# Incident lifecycle and AI fields.
icp canister call backend createIncident '("CI smoke incident", "high", "ci", "synthetic test log")'
icp canister call backend updateIncidentStatus '(1, "in_progress")'
icp canister call backend updateIncidentAIFields '(1, "summary", "root cause", "suggested fix")'
INCIDENT="$(icp canister call backend getIncident '(1)')"
[[ "$INCIDENT" == *"in_progress"* && "$INCIDENT" == *"summary"* ]] || { echo "Incident update/read failed"; exit 1; }

# Comment identity must come from the authenticated principal, not a browser label.
icp canister call backend addComment '(1, "forged display name", "CI comment")'
ADMIN_PRINCIPAL="$(icp identity principal --identity "$ADMIN_IDENTITY")"
COMMENTS="$(icp canister call backend getCommentsByIncident '(1)')"
[[ "$COMMENTS" == *"$ADMIN_PRINCIPAL"* && "$COMMENTS" != *"forged display name"* ]] || { echo "Comment author identity check failed"; exit 1; }

# Metric and alert write/read/update paths.
icp canister call backend addMetric '("cpu_usage", 42.5, "%", "ci")'
METRICS="$(icp canister call backend getMetricsByName '("cpu_usage")')"
[[ "$METRICS" == *"42.5"* ]] || { echo "Metric round-trip failed"; exit 1; }

icp canister call backend addAlert '("CI test alert", "medium", "ci", "test message")'
icp canister call backend updateAlertStatus '(1, "acknowledged")'
ALERTS="$(icp canister call backend getAlerts)"
[[ "$ALERTS" == *"acknowledged"* ]] || { echo "Alert update/read failed"; exit 1; }
icp canister call backend getDashboardSummary

# A second principal must register as a normal user and must not delete incidents.
icp identity default "$USER_IDENTITY"
icp canister call backend _initializeAccessControlWithSecret '("")'
USER_ROLE="$(icp canister call backend getCallerUserRole)"
[[ "$USER_ROLE" == *user* ]] || { echo "Regular caller did not receive user role"; exit 1; }
icp canister call backend createIncident '("CI user incident", "low", "ci", "user-created log")'
if icp canister call backend deleteIncident '(1)' >"$TMP_DIR/unauthorized-delete.log" 2>&1; then
  echo "Regular user unexpectedly deleted an incident"
  exit 1
fi
icp canister call backend updateIncidentStatus '(2, "resolved")'

# Admin-only deletion must work, while a regular user's attempt above was denied.
icp identity default "$ADMIN_IDENTITY"
icp canister call backend deleteIncident '(1)'
if icp canister call backend getIncident '(1)' >"$TMP_DIR/deleted-incident.log" 2>&1; then
  echo "Deleted incident is still readable"
  exit 1
fi

echo "Backend runtime smoke tests passed: admin bootstrap, regular-user registration, profile, incident, comment identity, metrics, alerts, dashboard, permission denial, and admin deletion."
