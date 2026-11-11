# CloudSentinels platform architecture readiness

**Scope:** prepare the AWS-native CloudSentinels platform architecture, contracts, deployment path, security boundaries, and validation before the minor review. **EKS cluster provisioning and workload deployment are explicitly excluded.**

This document separates implemented repository capabilities from designed-but-not-yet-integrated capabilities. A green infrastructure CI run validates code and templates; it does not prove that an external integration, AI provider, cluster agent, or live remediation path is connected.

## 1. Architecture at a glance

~~~mermaid
flowchart TB
  subgraph L1["Layer 1 — Execution environments"]
    EKS["EKS / EC2 node groups (deferred)"]
    FARGATE["EKS Fargate profiles (deferred)"]
    LOCAL["K3s / Kind / Minikube + local agent (agent implementation pending)"]
  end
  subgraph L2["Layer 2 — Identity and connectivity"]
    USER["Web application"]
    COG["Cognito JWT authorizer"]
    API["API Gateway HTTP API + Lambda"]
    AGENT["Authenticated cluster / local-agent ingress (contract required)"]
  end
  subgraph L3["Layer 3 — Detection and control"]
    DETECT["Event normalization + incident correlation"]
    AI["AI diagnosis provider (integration pending)"]
    POLICY["Deterministic policy + approval"]
    PROC["Procedure registry"]
  end
  subgraph L4["Layer 4 — Durable automation"]
    EB["EventBridge"]
    SQS["SQS + DLQs"]
    COORD["Automation processor"]
    ZAP["Optional Zapier relay / signed approval"]
    ADAPTER["Scoped execution adapter (not deployed)"]
    VERIFY["Post-action verification + audit"]
  end
  USER --> COG --> API
  API --> DETECT --> EB --> SQS --> COORD
  AGENT --> DETECT
  COORD --> PROC --> POLICY
  POLICY --> ZAP
  POLICY --> ADAPTER --> VERIFY
  VERIFY --> DETECT
  LOCAL -. local buffering/replay .-> AGENT
  EKS -. Kubernetes events/metrics .-> AGENT
  FARGATE -. Kubernetes events/metrics .-> AGENT
  AI -. enrichment recommendation .-> POLICY
~~~

## 2. Component readiness matrix

| Component | Repository state | Ready without EKS? | Remaining proof / dependency |
|---|---|---:|---|
| Four-layer architecture and event lifecycle | Architecture Markdown + editable Mermaid diagram | Yes | Architecture review |
| User identity and application API | Cognito + API Gateway JWT authorizer + Lambda routes in CloudFormation | Yes | Dedicated non-root deployment identity; external authenticated end-to-end test |
| Application persistence | DynamoDB single-table design with per-user partition keys | Yes | Backup/restore and data-retention policy review |
| Event transport | EventBridge custom bus, SQS queues, redrive/DLQs | Yes | Deploy reviewed runtime template and run harmless event-through-queue test |
| Automation coordinator | Event classification, idempotent event records, dynamic procedure lookup, validation guardrails | Yes, observe/classify mode | Verify procedure query and processor against deployed DynamoDB; adapter is separate |
| Procedure catalogue | Versioned DynamoDB contract and allowlisted action identifiers | Yes | Populate reviewed procedure records and test policy decisions |
| Human approval / Zapier | HMAC-signed command receiver, optional relay, queue/worker templates, unit tests | Partly | Configure real Zapier workflow/secrets and test signed approval end-to-end |
| Observability | CloudWatch alarms for API/processor errors, queue age, DLQs, optional workers | Yes | Deploy alarms; add SNS/operator alarm actions and test notification |
| Kubernetes metrics rules | Prometheus Operator rules for crash loops, unavailable replicas, CPU and memory | Manifest ready | Validate metrics/labels on a real non-production cluster later |
| Cluster registration and telemetry adapter | Architectural contract only; no live adapter/agent implementation verified | No | Build/authenticate adapter and define registration lifecycle |
| Alertmanager-to-CloudSentinels ingestion | No deployed webhook path verified | No | Implement authenticated webhook, replay protection, schema validation, rate limits |
| AI incident analysis | Architecture target only; no model/provider integration verified | No | Select provider, secrets, data minimization, prompt-injection controls, evaluation and fallback |
| Kubernetes remediation executor | Worker dispatcher contract/tests exist; no live Kubernetes adapter verified | No | Build scoped adapter, idempotency, policy checks and postcondition verification |
| Offline/local cluster mode | Design supports local buffering/replay; agent binary/service not verified | No | Build local agent, durable local queue, secure enrollment and reconnect protocol |
| EKS compute/network | Deliberately not provisioned | Deferred by request | Minor-review approval, budget, region, network and sizing decision |

## 3. Canonical event envelope

All producers should normalize signals into one versioned envelope before publishing to EventBridge. The current processor consumes EventBridge events and stores a bounded subset; this is the target contract for future cluster and Alertmanager adapters.

~~~json
{
  "schemaVersion": "1",
  "eventId": "producer-generated-unique-id",
  "occurredAt": "2026-11-10T10:00:00.000Z",
  "source": "cloudsentinels.cluster-agent",
  "detailType": "PodCrashLoopBackOff",
  "environment": "non-production",
  "cluster": {
    "clusterId": "registered-cluster-id",
    "name": "review-cluster",
    "provider": "kubernetes",
    "region": "ap-south-1"
  },
  "resource": {
    "kind": "Pod",
    "namespace": "demo",
    "name": "sample-api"
  },
  "severity": "warning",
  "deduplicationKey": "cluster/namespace/kind/name/reason",
  "observedAt": "2026-11-10T10:00:00.000Z",
  "attributes": {
    "reason": "CrashLoopBackOff"
  }
}
~~~

Contract rules:
- Producers must use a stable unique event ID; retries reuse that ID.
- schemaVersion, timestamps, source, detail type, cluster identity, and resource identity are validated and bounded.
- Never include kubeconfig, bearer tokens, AWS credentials, secret values, raw environment dumps, or unrestricted log payloads.
- Use an authenticated producer identity; do not trust a clusterName string as proof that a cluster is registered.
- Enforce event size limits, rate limits, timestamp skew, replay protection, and per-cluster authorization at ingress.
- Preserve the producer's source timestamp and record ingestion time separately.
- Unknown event types are observe-only until a reviewed procedure exists.

## 4. Incident and remediation lifecycle

1. **Observe:** Kubernetes watch, Prometheus/Alertmanager, cloud event, or local agent detects a signal.
2. **Authenticate:** producer identity is validated and authorized for the registered cluster.
3. **Normalize:** validate the canonical envelope, enforce size/rate/replay limits, and attach ingestion metadata.
4. **Correlate:** deduplicate by event/resource/window and create or update an incident.
5. **Enrich:** optional AI analysis returns structured hypotheses and evidence references; it cannot emit executable commands.
6. **Resolve:** procedure registry selects a versioned allowlisted action and records the policy decision.
7. **Approve:** low-risk actions may be eligible for policy-based automation; high/critical or destructive actions require explicit approval.
8. **Dispatch:** the executor receives a signed, scoped command with an idempotency key, deadline and retry budget.
9. **Verify:** query the target system independently and verify explicit postconditions.
10. **Close/escalate:** update the incident and audit record; unresolved actions are escalated and bounded retries end in a DLQ.

A command being accepted or queued is not a successful remediation. Mark recovery complete only after independent verification.

## 5. Trust boundaries and controls

| Boundary | Required control |
|---|---|
| Browser → API | Cognito JWT validation, user ownership from verified sub, input bounds, no-store responses |
| GitHub Actions → AWS | OIDC with aud=sts.amazonaws.com, repository/environment-specific sub, protected environment approval, short-lived credentials |
| CloudFormation → AWS | Separate scoped CloudFormation execution role; narrow iam:PassRole |
| Agent → ingestion API | Short-lived per-cluster identity, revocation/rotation, cluster-scoped authorization |
| EventBridge → SQS | Queue resource policy restricted to the exact rule ARN, encryption, redrive/DLQ |
| Coordinator → procedure registry | Strict schema validation, version pinning, allowlisted actions, disabled/invalid entries blocked |
| Approval service → command queue | HMAC signature, timestamp/replay window, event/action binding, approval-state check |
| Executor → Kubernetes | Namespace/resource-scoped RBAC, allowlisted operations, timeouts, bounded retries, idempotency |
| AI provider → control plane | Data minimization, no secrets, structured output validation, prompt-injection resistance, human approval for risky actions |

Do not grant Zapier direct kubeconfig access or unrestricted AWS credentials. Zapier is an integration and approval layer, not the privileged cluster executor.

## 6. Deployment and release order (excluding EKS)

1. Establish an authorized non-root AWS operator and a dedicated GitHub OIDC deployment role.
2. Protect the GitHub preview environment with reviewer approval and branch restrictions.
3. Verify the separate CloudFormation execution role and artifact bucket permissions.
4. Review the runtime CloudFormation change set; deploy only the serverless API/event/queue/processor stack.
5. Send a harmless event and verify EventBridge → SQS → Lambda → DynamoDB record, including duplicate-event behavior and DLQ handling.
6. Configure CloudWatch alarm actions (SNS or approved destination), then test one alarm path.
7. Configure the actual Zapier Catch Hook and signing secret; verify outbound notification and inbound signed approval without a cluster adapter.
8. Build and test the authenticated telemetry ingestion service and cluster enrollment contract independently of EKS (fixture-based tests are acceptable).
9. Add an AI provider only after selecting the provider, defining the data boundary, and testing structured output and safe fallback.
10. Keep remediation execution disabled until a real adapter passes RBAC, idempotency, approval, timeout, and postcondition tests.
11. Complete the application/API integration tests and record evidence in the review packet.

The existing manual GitHub workflow deploys only the preview runtime stack. It is not an EKS deployment workflow and does not configure the external Zapier account, GitHub environment, OIDC provider, or IAM roles automatically.

## 7. EKS remains a later, explicit gate

No EKS cluster, node group, EKS add-on, load balancer, NAT gateway, or cluster workload should be created as part of this architecture-preparation phase. The EKS runbook is the sole provisioning checklist for the minor-review event. Before any later create operation, approve:
- account and region;
- EKS version and support window;
- VPC/subnets, endpoint exposure and access source ranges;
- node type/count/autoscaling and storage;
- add-ons and cluster-agent RBAC;
- hourly/monthly budget and teardown deadline;
- workload manifests and immutable image references;
- operator identity and protected deployment workflow.

Airtable is inventory/demo metadata only. It is not a source of truth for infrastructure or workload manifests.

## 8. Evidence required to call the non-EKS architecture ready

- [x] Architecture diagram and four-layer design documentation committed.
- [x] Serverless CloudFormation/SAM templates and local deployment scripts present.
- [x] API, automation processor, remediation dispatcher and Zapier code paths have unit tests.
- [x] Dynamic procedure registry validation and approval guardrails implemented.
- [x] CloudWatch metric alarms defined for core queue, DLQ and Lambda failure signals.
- [x] AWS architecture CI passes on the current PR head.
- [ ] GitHub OIDC provider, protected environment and deployment role configured in AWS/GitHub.
- [ ] Runtime change set deployed and EventBridge → SQS → processor flow verified in the target account.
- [ ] CloudWatch alarm notifications routed and tested.
- [ ] Live Zapier workflow delivery and signed approval verified.
- [ ] Authenticated telemetry ingestion and cluster enrollment adapter implemented and tested.
- [ ] AI provider integrated and evaluated, or explicitly removed from the initial product scope.
- [ ] Real execution adapter tested with an isolated Kubernetes test target; EKS provisioning remains deferred.
- [ ] End-to-end acceptance evidence and operational ownership recorded.

**Status statement:** The architecture, deployment templates, contracts, guardrails, runbooks, and CI validation are prepared in source control. The platform is not yet an end-to-end live self-healing service: live AWS deployment, external Zapier delivery, telemetry-agent integration, AI provider integration, and Kubernetes execution remain separate acceptance gates. This distinction is intentional and prevents design readiness from being mistaken for production operation.
