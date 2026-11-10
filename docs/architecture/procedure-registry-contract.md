# Dynamic remediation procedure registry contract

The procedure registry extends event coverage without adding a new conditional branch for every failure signature. Procedures are versioned data records in the existing CloudSentinels DynamoDB table.

## Record key and fields

- `PK`: `SYSTEM#PROCEDURES`
- `SK`: `PROCEDURE#<EventBridge detail-type>#<zero-padded version>`
- `procedureId`: stable human-readable identifier
- `version`: positive integer; zero-pad the version in `SK` so descending lexical order selects the latest version
- `enabled`: boolean; disabled records are observe-only
- `action`: one of the execution adapter's explicit action identifiers
- `risk`: `low`, `medium`, `high`, or `critical`
- `requiresApproval`: boolean; high-blast-radius operations must require approval

The coordinator rejects records without a non-empty `procedureId` (maximum 128 characters), a positive safe-integer `version`, and an explicit boolean `enabled` flag. Procedures with `risk: high` or `risk: critical` are invalid unless `requiresApproval` is `true`. Invalid records are blocked and surfaced as `BLOCKED_INVALID_PROCEDURE`; they never fall back to an unsafe action.

Example:

```json
{
  "PK": "SYSTEM#PROCEDURES",
  "SK": "PROCEDURE#PodCrashLoopBackOff#000003",
  "procedureId": "pod-crashloop-diagnose-and-restart",
  "version": 3,
  "enabled": true,
  "action": "restart-pod",
  "risk": "low",
  "requiresApproval": false
}
```

## Supported action identifiers

The coordinator accepts only these currently implemented action identifiers:

- `restart-pod`
- `replace-or-recover-node`
- `scale-workload`
- `diagnose-memory-pressure`
- `rollback-deployment`
- `scale-or-investigate-service`

A registry item cannot contain shell commands, scripts, arbitrary URLs, arbitrary Lambda ARNs, or arbitrary Kubernetes patch bodies. A new action requires an audited adapter implementation, scoped RBAC, tests, and a reviewed deployment.

## Resolution semantics

1. Normalize and bound the EventBridge `detail-type`.
2. Query `SYSTEM#PROCEDURES` for the matching event prefix, descending by sort key, limit one.
3. If no record exists, use the built-in baseline classifier.
4. If disabled, record `OBSERVED` and do not recommend an action.
5. If required metadata is missing, the action/risk is unsupported, or a high/critical-risk procedure does not require approval, record `BLOCKED_INVALID_PROCEDURE`.
6. If the event has no registered cluster target, record `BLOCKED_NO_CLUSTER_TARGET`.
7. Otherwise record either `PENDING_APPROVAL` or `PENDING_CLUSTER_ADAPTER`. This is a classification, not proof of execution.

## Operational guardrails

- Event ID is the idempotency key; duplicate events are ignored.
- Queue retries are bounded and poison messages go to a DLQ.
- Each executor must enforce action-level timeout, retry budget, and circuit breaker.
- Unknown event types default to observe-only until a registry entry is reviewed.
- AI may recommend a procedure but cannot author executable code or bypass approval.
- Production node replacement, storage deletion, network/security changes, and rollbacks require explicit approval.
- Recovery is complete only after the adapter verifies postconditions against the target cluster.
