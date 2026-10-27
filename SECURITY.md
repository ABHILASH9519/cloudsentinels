# Security Policy

## Authentication and authorization

CloudSentinels currently authenticates interactive users through Internet Identity. Do not treat a frontend route guard as authorization: protected operations must enforce permissions in the Motoko backend.

The administrator bootstrap uses the `CLOUDSENTINELS_ADMIN_TOKEN` runtime environment variable. Supply it only through the deployment platform's secret mechanism. Never commit the token, put it in a `VITE_*` variable, or expose it to browser code. Restrict bootstrap access, verify the first administrator principal explicitly, and remove the bootstrap secret from the runtime environment after setup where the deployment workflow permits it.

## Telemetry ingestion

The current `addMetric` and `addAlert` methods are application write APIs, not a production Prometheus ingestion endpoint. Do not expose them to unauthenticated services or send the canister an untrusted alert payload. A production adapter should authenticate Alertmanager requests, validate and bound every field, rate-limit requests, and use a dedicated least-privilege identity or authenticated server-side path.

## Data durability

Backend records are currently held in in-memory maps. Verify stable persistence across canister upgrades and implement migration/upgrade tests before storing operationally critical incident history.

## Reporting

Please report suspected vulnerabilities privately to the repository owner rather than publishing exploit details in an issue.
