# CloudSentinels — Go-first cloud and Kubernetes observability

## Product goal

CloudSentinels combines a normalized Airtable cluster inventory, real Kubernetes telemetry, explainable incident triage and approval-gated operational workflows in one application.

## Technology boundaries

- Core backend: Go HTTP API, Go Kubernetes agent and Go AWS Lambda adapter.
- Frontend: React + TypeScript dashboard; it is the presentation layer, not the backend runtime.
- Identity: Amazon Cognito OIDC for web users; dedicated bearer credentials for cluster agents.
- Inventory: Airtable REST API with a sanitized snapshot fallback.
- Cloud runtime: AWS API Gateway, Lambda, DynamoDB, EventBridge, SQS and Secrets Manager.
- Automation: Zapier Catch Hooks, HMAC-signed callbacks and GitHub Actions notifications.
- Kubernetes: Docker-backed local Minikube and remote in-cluster agents with read-only RBAC by default.

The deployed AWS Operations Lambda still serves persistent incident/alert/profile workflows in Node.js, and the EventBridge/SQS/Zapier relay workers are also Node.js. Porting these deployed handlers to Go is an explicit remaining migration task; do not describe the entire AWS runtime as Go until that work is complete.

## Functional requirements

1. Read the approved Airtable cluster fields and preserve the same cluster IDs across online and local Kubernetes views.
2. Collect real node, pod, warning-event, CPU and memory telemetry from connected Kubernetes agents.
3. Display inventory provenance, telemetry source, collection time and stale/offline state.
4. Analyze health using explainable deterministic rules and return evidence and safe recommended checks.
5. Support Cognito-authenticated application routes and agent-specific authentication.
6. Send sanitized application events to Zapier and verify signed inbound command requests.
7. Keep mutating Kubernetes actions disabled unless human approval and scoped RBAC are explicitly configured.
8. Validate the Go API, agent, Lambda ARM64 build, Docker images and frontend with GitHub Actions.

## Delivery boundaries

- Airtable-reported CPU and memory are inventory values, not streaming metrics.
- A connected agent is required for live Kubernetes telemetry.
- The current rules engine is not a trained ML model or LLM.
- In-memory Go queues and telemetry caches are not durable production storage.
- EKS provisioning and EC2 hosting are separate infrastructure operations and must be verified in the target AWS account.
