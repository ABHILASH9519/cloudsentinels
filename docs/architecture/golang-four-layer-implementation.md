# CloudSentinels Go four-layer architecture

## Objective

CloudSentinels is a DevOps web application service with one shared Go control plane and three execution targets. The UI is the presentation layer; cloud and local credentials are resolved in a dedicated identity layer; incident intelligence and remediation policy live in a shared core; Zapier is an external workflow/notification adapter.

## Layer 1 — Presentation and execution targets

The web UI exposes three target types:

1. **Online / server:** a continuously running Go API and worker service, deployable on ECS, EKS or another managed container platform.
2. **Online / serverless:** Go Lambda handlers using the same application services and domain contracts as the server runtime.
3. **Offline / local Kubernetes:** a local Go agent/control-plane process that talks to the selected kubeconfig context and continues operating without cloud connectivity where local dependencies permit.

All three targets call the same Layer 3 use cases. Execution-target adapters must not duplicate incident classification, AI analysis or remediation policy.

## Layer 2 — Authentication and credentials

- AWS web identity: Cognito OIDC access tokens, issuer/audience validation, short-lived sessions.
- AWS workload identity: IAM roles and STS assumed-role credentials; prefer workload identity/OIDC over static access keys.
- Local Kubernetes identity: local OS session plus explicit kubeconfig context selection; use Kubernetes RBAC and short-lived credentials where supported.
- Credentials are never sent to Zapier, browser local storage, logs or incident payloads. Secrets are resolved server-side from AWS Secrets Manager or a local OS secret provider.
- Each request and action is bound to a tenant, principal, target and least-privilege capability set.

## Layer 3 — Shared CloudSentinels core

The Go core owns:
- **Detection:** normalize CloudWatch, EventBridge, Prometheus, Alertmanager and Kubernetes signals into a common incident/event contract.
- **AI analysis:** provider-neutral analysis interface for evidence summarization, anomaly context, root-cause hypotheses and recommended actions. AI output is advisory, schema-validated and never grants permissions.
- **Remediation orchestration:** policy evaluation, risk classification, idempotency, approval state, execution adapter selection, timeout/retry, audit trail and post-action verification.

The online server, serverless handler and offline agent all invoke these same application services. Adapters provide infrastructure access; the domain policy remains shared.

## Layer 4 — Zapier automation

Zapier receives signed, minimized incident events and may:
- notify Slack, email, Teams or other configured channels;
- request a human approval and capture decision metadata;
- launch documented procedures and escalation paths;
- trigger a signed approval callback or remediation request;
- return delivery and workflow outcomes for correlation.

Zapier is not the policy authority and does not receive raw credentials. CloudSentinels independently verifies the signature, event state, approval, action allow-list, target scope and idempotency key before dispatch. High-risk and destructive actions require explicit approval. Failed or expired workflows remain visible as incidents; retries use bounded backoff and dead-letter handling.

## Dependency direction

`UI -> API/use cases -> domain policies -> ports <- infrastructure adapters`

AWS, Kubernetes, database, AI provider and Zapier integrations implement ports. The domain package does not import cloud SDKs or HTTP provider clients.

## Safety invariants

1. Default to read-only discovery.
2. No credential material in the UI-to-Zapier event contract.
3. AI recommendations cannot authorize actions.
4. Approval binds to an immutable action, target, parameters and expiry.
5. Every mutation requires target-scoped authorization and an audit record.
6. Use idempotency keys and verify the postcondition after an action.
7. Offline mode clearly reports which features are unavailable without network access.
8. Server and Lambda deployments share the same domain/use-case packages.

## Migration plan

1. Introduce Go module, service entrypoint, API contract and health endpoints (current slice).
2. Implement Cognito and local identity adapters; keep protected routes fail-closed until configured.
3. Replace process-memory demo storage with durable repositories and migrations.
4. Implement AWS and Kubernetes signal adapters and normalized event ingestion.
5. Implement AI provider adapter and deterministic risk/policy engine.
6. Implement signed Zapier event delivery, approval callbacks and workflow correlation.
7. Implement read-only local Kubernetes agent; add opt-in, approval-gated remediation after security tests.
8. Deploy Go server and Go Lambda targets; retire Node/Motoko runtime only after feature parity, data migration and rollback validation.

## Current slice limitations

This commit is a bootstrap, not a completed production migration. The API's health/readiness/platform endpoints work; incident routes are disabled until an authenticator is supplied. The demo incident map is process-local only. No cloud resources are provisioned and no live cluster actions are enabled by this code.
