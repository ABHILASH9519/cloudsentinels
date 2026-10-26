# CloudSentinels

CloudSentinels is an incident-management and observability console for teams operating cloud workloads and Kubernetes clusters. The current implementation uses a React/TypeScript frontend and a Motoko backend on the Internet Computer.

## Current capabilities in source

- Internet Identity sign-in and caller-scoped user profiles
- Incident creation, listing, status updates, details, comments, and deletion restricted to administrators
- Alert and metric records with dashboard summaries and periodic frontend refresh
- AI insight fields for summaries, root causes, and suggested fixes, populated through authorized backend calls
- Role/permission checks in backend methods

## Kubernetes monitoring starter

A Prometheus Operator ruleset is available at [deploy/kubernetes/prometheus-rules.yaml](deploy/kubernetes/prometheus-rules.yaml). It covers pod crash loops, unavailable deployment replicas, and high container CPU/memory relative to resource requests. Installation prerequisites and commands are documented in [deploy/kubernetes/README.md](deploy/kubernetes/README.md).

These rules create alerts in Prometheus; they do not automatically ingest alerts into the CloudSentinels UI. An authenticated Alertmanager/webhook adapter is still required for that connection.

## Important scope and integration notes

The repository currently stores application records in the backend canister's in-memory Map values. Those values are not a substitute for a separately managed SQL database, and persistence across canister upgrades must be verified before treating this as production durable. A production Kubernetes/Prometheus ingestion adapter, live cluster discovery, and a real AI inference service must be configured and tested separately. The UI's metric/alert records should not be represented as live cluster telemetry until an ingestion source is connected.

Authentication currently uses Internet Identity rather than email/password. Roles and permissions are governed by the backend authorization module; test role assignment and first-admin bootstrap explicitly before production use.

## Development

The repository is an Internet Computer project with a pnpm workspace, React/Vite frontend, and Motoko backend. Use the scripts and toolchain configured in Dockerfile, build.sh, and icp.yaml. Before deploying, run frontend type checking, linting, and a full canister build in a clean environment, then test the complete authentication and CRUD flows against a local replica.

## Deployment checklist

- [ ] Reproducible clean install and build
- [ ] Authentication and role-permission integration tests
- [ ] Verify stable persistence across canister upgrades
- [ ] Connect and validate Prometheus/Kubernetes telemetry ingestion
- [ ] Configure alert delivery and AI inference provider securely
- [ ] Validate API authentication, rate limits, input bounds, and audit history
- [ ] Deploy to a non-production environment and run end-to-end smoke tests

CloudSentinels should not be described as production-ready until these checks pass in the target environment.
