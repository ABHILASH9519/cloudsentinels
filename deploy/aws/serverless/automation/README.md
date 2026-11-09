# CloudSentinels automation coordinator

The runtime stack routes selected CloudSentinels API and cluster-agent events through EventBridge into the automation SQS queue. `AutomationProcessor` consumes that queue and writes idempotent automation-run records to the shared DynamoDB table (`PK=SYSTEM#AUTOMATION`, `SK=EVENT#<event-id>`).

The processor is intentionally non-destructive until a Kubernetes target is registered and a Kubernetes API adapter, scoped RBAC, and approval policy are configured. It classifies supported event types such as `PodCrashLoopBackOff`, `NodeNotReady`, `CpuThresholdExceeded`, `MemoryPressure`, `DeploymentUnhealthy`, and `ApiLatencyHigh`. Missing targets are recorded as `BLOCKED_NO_CLUSTER_TARGET`; high-risk actions with a target are recorded as `PENDING_APPROVAL`; lower-risk actions with a target are recorded as `PENDING_CLUSTER_ADAPTER`. Unknown events are retained as `OBSERVED`.

SQS partial batch responses allow failed records to retry independently. Event IDs are the idempotency key, and duplicate deliveries are safely ignored. No event is marked recovered: `recoveryVerified` remains false until a future adapter performs an action and verifies the cluster's resulting state.
