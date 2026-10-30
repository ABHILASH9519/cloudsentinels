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
- [ ] Authentication and role-permission integration tests against a local replica
- [ ] Verify stable persistence across canister upgrades
- [ ] Connect and validate Prometheus/Kubernetes telemetry ingestion
- [ ] Configure alert delivery and AI inference provider securely
- [ ] Validate API authentication, rate limits, input bounds, and audit history
- [ ] Deploy to a non-production environment and run end-to-end smoke tests

CloudSentinels should not be described as production-ready until these checks pass in the target environment.


## Demo walkthrough and sample dataset

A safe, fictional demo dataset is provided at [`sample-data/demo-observability.json`](sample-data/demo-observability.json). It models Kubernetes incidents, Prometheus-style metrics, and alerts; it is reference data, not live telemetry and is not automatically inserted into a deployed canister.

### Sign-in and first-run role setup

1. Create a strong random token locally and save it to `src/backend/secrets/admin-token`. The `src/backend/secrets/` directory is ignored by Git. Configure the backend canister's runtime setting to read that file:
   ```yaml
   settings:
     environment_variables:
       CLOUDSENTINELS_ADMIN_TOKEN:
         path: ./secrets/admin-token
   ```
   This setting belongs in `src/backend/canister.yaml`. The path is relative to that file. Deploy the backend with `icp deploy`; the canister reads the configured value at runtime. Never commit or share the token.
2. Open the app and choose **Sign in with Internet Identity**.
3. For the first administrator only, provide the bootstrap token in the URL hash fragment as `#cloudSentinelsAdminToken=YOUR_TOKEN` before authentication. The frontend extracts it and removes that parameter from the address bar. Do not use a normal query string.
4. Subsequent users should sign in without the bootstrap token; they are assigned the regular user role. Keep the admin token out of screenshots, chat messages, shell history, and source control.

If the token is not configured in the backend environment, role initialization fails. If an administrator has already been assigned, presenting the token does not promote another principal.

### Walkthrough

1. Sign in, then open **Incidents** and create an incident with a source such as `kubernetes` and a pod event in the raw log.
2. Open **Monitoring** and add a metric such as `container_cpu_usage_percent = 82` (%) with source `demo-cluster`.
3. Add an alert such as **High CPU on payments-api** with severity `high` and source `prometheus-demo`.
4. Return to **Dashboard** to see incident counts, severity/status charts, active alerts, and latest metric records.
5. Acknowledge or resolve the alert from Monitoring and verify that the active-alert count updates.

The demo records created through the UI are stored by the current backend implementation. The Monitoring page now includes **Load sample data**, which imports the fictional incidents, metrics, and alerts through the authenticated backend methods. Imported records use a `demo/` source prefix and the operation can be safely retried without duplicating matching records. This is test data, not live telemetry. Backend maps and role state still require upgrade-persistence verification before production use. Kubernetes rule files generate Prometheus alerts but do not by themselves send them into this UI.
