# CloudSentinels automation coordinator

The runtime stack routes selected CloudSentinels API and cluster-agent events through EventBridge into the automation SQS queue. `AutomationProcessor` consumes that queue and writes idempotent automation-run records to the shared DynamoDB table (`PK=SYSTEM#AUTOMATION`, `SK=EVENT#<event-id>`).

The processor is intentionally non-destructive until a Kubernetes target is registered and a Kubernetes API adapter, scoped RBAC, and approval policy are configured. It classifies supported event types such as `PodCrashLoopBackOff`, `NodeNotReady`, `CpuThresholdExceeded`, `MemoryPressure`, `DeploymentUnhealthy`, and `ApiLatencyHigh`. Missing targets are recorded as `BLOCKED_NO_CLUSTER_TARGET`; high-risk actions with a target are recorded as `PENDING_APPROVAL`; lower-risk actions with a target are recorded as `PENDING_CLUSTER_ADAPTER`. Unknown events are retained as `OBSERVED`.

SQS partial batch responses allow failed records to retry independently. Event IDs are the idempotency key, and duplicate deliveries are safely ignored. No event is marked recovered: `recoveryVerified` remains false until a future adapter performs an action and verifies the cluster's resulting state.


## Versioned procedure registry

The processor now checks the shared DynamoDB table for a matching procedure before falling back to its built-in baseline rules:

- Partition key: `PK = SYSTEM#PROCEDURES`
- Sort key: `SK = PROCEDURE#<event-type>#<zero-padded-version>`
- Example key: `PROCEDURE#PodCrashLoopBackOff#000003`

Example item:

```json
{
  "PK": "SYSTEM#PROCEDURES",
  "SK": "PROCEDURE#PodCrashLoopBackOff#000003",
  "procedureId": "pod-crashloop-restart",
  "version": 3,
  "enabled": true,
  "action": "restart-pod",
  "risk": "low",
  "requiresApproval": false
}
```

Each event type can have independently versioned procedures. The latest matching version is selected by descending sort-key order. Set `enabled: false` to keep the signal observe-only. Unknown event types can be introduced by adding a registry record; no code branch is required for each new event signature.

**Safety boundary:** registry records are configuration, not executable code. The coordinator accepts only actions already supported by the remediation adapter allowlist (`restart-pod`, `replace-or-recover-node`, `scale-workload`, `diagnose-memory-pressure`, `rollback-deployment`, `scale-or-investigate-service`). Unsupported or malformed actions are blocked. Production/high-risk procedures should require approval. Adding a new action still requires an audited adapter implementation and tests.

The coordinator only classifies and queues work. It does not claim that a procedure ran or that recovery was verified. An enabled adapter, target registration, least-privilege RBAC, and post-action health verification are required for execution.
