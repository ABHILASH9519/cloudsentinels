#!/usr/bin/env bash
set -euo pipefail

ADMIN_IDENTITY="cloudsentinels-ci-admin"
USER_IDENTITY="cloudsentinels-ci-user"
ADMIN_TOKEN="ci-only-cloudsentinels-bootstrap-token"
TMP_DIR="$(mktemp -d)"
CURRENT_IDENTITY="$ADMIN_IDENTITY"

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
CURRENT_IDENTITY="$ADMIN_IDENTITY"

icp network start -d
icp deploy backend

# Configure a test-only canister runtime secret, then exercise the same
# registration method called by the authenticated frontend actor.
icp canister settings update backend --identity "$ADMIN_IDENTITY" --add-environment-variable "CLOUDSENTINELS_ADMIN_TOKEN=$ADMIN_TOKEN"
SETTINGS="$(icp canister settings show backend --json --identity "$ADMIN_IDENTITY")"
[[ "$SETTINGS" == *"CLOUDSENTINELS_ADMIN_TOKEN"* ]] || { echo "Admin token runtime setting was not applied"; exit 1; }
icp canister call --identity "$CURRENT_IDENTITY" backend _initializeAccessControlWithSecret "(\"$ADMIN_TOKEN\")"
ADMIN_STATUS="$(icp canister call --identity "$CURRENT_IDENTITY" backend isCallerAdmin '()')"
[[ "$ADMIN_STATUS" == *true* ]] || { echo "First authenticated caller was not made admin; admin check: $ADMIN_STATUS"; exit 1; }

# Profile CRUD.
icp canister call --identity "$CURRENT_IDENTITY" backend saveCallerUserProfile '(record { name = "CI Admin" })'
PROFILE="$(icp canister call --identity "$CURRENT_IDENTITY" backend getCallerUserProfile '()')"
[[ "$PROFILE" == *"CI Admin"* ]] || { echo "Profile round-trip failed"; exit 1; }

# Incident lifecycle and AI fields.
icp canister call --identity "$CURRENT_IDENTITY" backend createIncident '("CI smoke incident", "high", "ci", "synthetic test log")'
if icp canister call --identity "$CURRENT_IDENTITY" backend createIncident '("Invalid severity", "urgent", "ci", "must be rejected")' >"$TMP_DIR/invalid-severity.log" 2>&1; then
  echo "Backend accepted an unsupported incident severity"
  exit 1
fi
if icp canister call --identity "$CURRENT_IDENTITY" backend updateIncidentStatus '(1, "closed")' >"$TMP_DIR/invalid-status.log" 2>&1; then
  echo "Backend accepted an unsupported incident status"
  exit 1
fi
icp canister call --identity "$CURRENT_IDENTITY" backend updateIncidentStatus '(1, "in_progress")'
icp canister call --identity "$CURRENT_IDENTITY" backend updateIncidentAIFields '(1, "summary", "root cause", "suggested fix")'
INCIDENT="$(icp canister call --identity "$CURRENT_IDENTITY" backend getIncident '(1 : nat)')"
[[ "$INCIDENT" == *"in_progress"* && "$INCIDENT" == *"summary"* ]] || { echo "Incident update/read failed"; exit 1; }

# Comment identity must come from the authenticated principal, not a browser label.
icp canister call --identity "$CURRENT_IDENTITY" backend addComment '(1, "forged display name", "CI comment")'
ADMIN_PRINCIPAL="$(icp identity principal --identity "$ADMIN_IDENTITY")"
COMMENTS="$(icp canister call --identity "$CURRENT_IDENTITY" backend getCommentsByIncident '(1 : nat)')"
[[ "$COMMENTS" == *"$ADMIN_PRINCIPAL"* && "$COMMENTS" != *"forged display name"* ]] || { echo "Comment author identity check failed"; exit 1; }

# Metric and alert write/read/update paths.
icp canister call --identity "$CURRENT_IDENTITY" backend addMetric '("cpu_usage", 42.5, "%", "ci")'
METRICS="$(icp canister call --identity "$CURRENT_IDENTITY" backend getMetricsByName '("cpu_usage")')"
[[ "$METRICS" == *"42.5"* ]] || { echo "Metric round-trip failed"; exit 1; }

icp canister call --identity "$CURRENT_IDENTITY" backend addAlert '("CI test alert", "medium", "ci", "test message")'
icp canister call --identity "$CURRENT_IDENTITY" backend updateAlertStatus '(1, "acknowledged")'
ALERTS="$(icp canister call --identity "$CURRENT_IDENTITY" backend getAlerts '()')"
[[ "$ALERTS" == *"acknowledged"* ]] || { echo "Alert update/read failed"; exit 1; }
icp canister call --identity "$CURRENT_IDENTITY" backend getDashboardSummary '()'

# A second principal must register as a normal user and must not delete incidents.
icp identity default "$USER_IDENTITY"
CURRENT_IDENTITY="$USER_IDENTITY"
icp canister call --identity "$CURRENT_IDENTITY" backend _initializeAccessControlWithSecret '("")'
USER_ADMIN_STATUS="$(icp canister call --identity "$CURRENT_IDENTITY" backend isCallerAdmin '()')"
[[ "$USER_ADMIN_STATUS" == *false* ]] || { echo "Regular caller unexpectedly received admin role"; exit 1; }
icp canister call --identity "$CURRENT_IDENTITY" backend createIncident '("CI user incident", "low", "ci", "user-created log")'
if icp canister call --identity "$CURRENT_IDENTITY" backend deleteIncident '(1 : nat)' >"$TMP_DIR/unauthorized-delete.log" 2>&1; then
  echo "Regular user unexpectedly deleted an incident"
  exit 1
fi
if ! grep -qi "Unauthorized" "$TMP_DIR/unauthorized-delete.log"; then
  cat "$TMP_DIR/unauthorized-delete.log"
  echo "Regular-user delete failed for a reason other than authorization"
  exit 1
fi

# Upgrade the canister and verify that records and authorization survive it.
icp identity default "$ADMIN_IDENTITY"
CURRENT_IDENTITY="$ADMIN_IDENTITY"
icp build backend
icp canister install backend --mode upgrade --identity "$ADMIN_IDENTITY"
POST_UPGRADE_INCIDENT="$(icp canister call --identity "$CURRENT_IDENTITY" backend getIncident '(1 : nat)')"
POST_UPGRADE_METRICS="$(icp canister call --identity "$CURRENT_IDENTITY" backend getMetricsByName '("cpu_usage")')"
POST_UPGRADE_ALERTS="$(icp canister call --identity "$CURRENT_IDENTITY" backend getAlerts '()')"
POST_UPGRADE_PROFILE="$(icp canister call --identity "$CURRENT_IDENTITY" backend getCallerUserProfile '()')"
[[ "$POST_UPGRADE_INCIDENT" == *"summary"* ]] || { echo "Incident state did not survive canister upgrade"; exit 1; }
[[ "$POST_UPGRADE_METRICS" == *"42.5"* ]] || { echo "Metric state did not survive canister upgrade"; exit 1; }
[[ "$POST_UPGRADE_ALERTS" == *"acknowledged"* ]] || { echo "Alert state did not survive canister upgrade"; exit 1; }
[[ "$POST_UPGRADE_PROFILE" == *"CI Admin"* ]] || { echo "Profile state did not survive canister upgrade"; exit 1; }

icp identity default "$USER_IDENTITY"
CURRENT_IDENTITY="$USER_IDENTITY"
USER_ADMIN_AFTER_UPGRADE="$(icp canister call --identity "$CURRENT_IDENTITY" backend isCallerAdmin '()')"
[[ "$USER_ADMIN_AFTER_UPGRADE" == *false* ]] || { echo "Regular caller gained admin role after canister upgrade"; exit 1; }
if icp canister call --identity "$CURRENT_IDENTITY" backend deleteIncident '(1 : nat)' >"$TMP_DIR/post-upgrade-unauthorized-delete.log" 2>&1; then
  echo "Regular user unexpectedly gained admin permission after upgrade"
  exit 1
fi
if ! grep -qi "Unauthorized" "$TMP_DIR/post-upgrade-unauthorized-delete.log"; then
  cat "$TMP_DIR/post-upgrade-unauthorized-delete.log"
  echo "Post-upgrade permission check failed for an unexpected reason"
  exit 1
fi

# Admin-only deletion must work, while regular-user attempts were denied.
icp identity default "$ADMIN_IDENTITY"
CURRENT_IDENTITY="$ADMIN_IDENTITY"
icp canister call --identity "$CURRENT_IDENTITY" backend deleteIncident '(1 : nat)'
if icp canister call --identity "$CURRENT_IDENTITY" backend getIncident '(1 : nat)' >"$TMP_DIR/deleted-incident.log" 2>&1; then
  echo "Deleted incident is still readable"
  exit 1
fi

echo "Backend runtime smoke tests passed: admin bootstrap, regular-user registration, profile, incident, comment identity, metrics, alerts, dashboard, permission denial, and admin deletion."
