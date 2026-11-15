# CloudSentinels — Review-Day Runbook

## Local review entry points

- UI: http://127.0.0.1:5174
- Go API health: http://127.0.0.1:8085/healthz
- Go API readiness: http://127.0.0.1:8085/readyz
- n8n: http://127.0.0.1:5678

Start or restore the local review stack from the repository root:

~~~powershell
.\scripts\start-review-stack.ps1
~~~

This loads the local ignored environment files, starts the Go API and Vite UI only when they are not already healthy, and attaches both agents with approved restart/rollback limited to the cloudsentinels-benchmark namespace. It does not call AWS or start paid infrastructure.

## Four execution layers

| Layer | Review state | Notes |
|---|---|---|
| Online server — AWS EKS | Prepared, not provisioned | No EKS cluster is currently running. The deployment workflow still requires a scoped non-root AWS deployment role and GitHub OIDC configuration. |
| Online serverless — AWS Lambda | Active legacy stack; not aligned | Two Node.js 22 Lambda functions are Active and the HTTP API stage v1 has 9 routes. Its JWT authorizer is Cognito, while the new Go API uses Firebase. Do not present the hosted stack as synchronized with the local Firebase build. |
| Offline — Docker Desktop Kubernetes | Running and tested | Same benchmark profile as Minikube; Metrics Server API is Available. |
| Local — Minikube | Running and tested | Profile/context name is cloudsentinels-local; Metrics Server API is Available. |

No AWS resources were started, invoked or modified during this preparation. The existing Lambda/API stack remains active but legacy; no EKS cluster was provisioned. Do not use root AWS credentials to deploy.

## Reproducible local cluster parity

Apply and verify the identical review profile:

~~~powershell
.\deploy\kubernetes\run-review-benchmark.ps1
~~~

Both local nodes report the same Kubernetes capacity at the time of the review:

- CPU capacity/allocatable: 16 cores
- Memory capacity/allocatable: 7,810,720 KiB
- Namespace quota: 2 CPU / 2 GiB requests; 3 CPU / 3 GiB limits; 20 pods maximum

Each cluster receives the same workload:

| Workload | Replicas | CPU request / limit per pod | Memory request / limit per pod |
|---|---:|---:|---:|
| nginx benchmark API | 3 | 100m / 500m | 128Mi / 256Mi |
| bounded CPU worker | 2 | 250m / 500m | 256Mi / 512Mi |
| Total | 5 | 800m requested / 2.5 CPU limit | 896Mi requested / 1.75Gi limit |

The two CPU worker pods intentionally generate bounded load (each capped at 500m). This provides a repeatable comparison without consuming the full host.

### Verified tests

- Both Kubernetes nodes Ready.
- Both benchmark deployments reached 3/3 and 2/2 Ready.
- In-cluster DNS and service request to benchmark-api returned the nginx welcome page on both clusters.
- One API pod was deliberately deleted on each cluster; the Deployment controller recreated it and restored 3/3 Ready.
- kubectl top nodes and kubectl top pods returned live metrics on both clusters.
- Metrics APIService v1beta1.metrics.k8s.io reported Available=True on both clusters.
- Signed n8n webhook delivery returned a successful HTTP response.
- Two CloudSentinels agents are attached to the Go API with approved remediation enabled only for the cloudsentinels-benchmark namespace.

Docker Desktop's Metrics Server uses --kubelet-insecure-tls for this local development cluster only. Do not copy that setting to production.

## Application capabilities and honest boundaries

- **Monitoring:** live node/pod/CPU/memory telemetry is collected by the local agents. Airtable inventory values remain separately identified as inventory snapshots.
- **Graphs:** Dashboard and Monitoring views use cluster inventory, local agent metrics and analysis findings; they do not fabricate historical time-series data.
- **AI analysis:** the current cluster analyzer is an explainable deterministic rules engine. It is not a trained ML model or an external LLM.
- **Automation and notifications:** signed event delivery to the configured local n8n webhook has been tested. Zapier remains dependent on its own Catch Hook configuration.
- **Self-healing:** the two local Kubernetes Deployments passed controller-level pod replacement tests. This demonstrates Kubernetes replica self-healing; it does not mean the CloudSentinels agent has automatically executed a remediation command.
- **Remediation safety:** the Clusters UI now exposes an explicit confirmation before queueing a benchmark API restart. The API requires an authenticated operator, confirmation, a registered cluster heartbeat and the cloudsentinels-benchmark namespace allowlist. Agents accept only approved restart/rollback actions; arbitrary shell commands and other namespaces are rejected. The queue and approval policy are unit-tested; an authenticated UI-to-agent restart has not yet been end-to-end exercised.
- **Persistence:** API incident/command state held only in process memory is lost when the API restarts. Do not describe it as durable storage.

## Authentication and hosted gaps to disclose

Firebase Admin initializes locally and the API readiness endpoint passes. A real user sign-in still depends on Firebase Console providers and authorized domains being enabled and verified. Do not use a Firebase service-account key in the frontend or commit local environment files.

The hosted AWS API still needs a Firebase-compatible deployment and route/auth alignment. EKS has not been provisioned. Those online layers are intentionally not started for this review and must not be marked live.

## Useful review commands

~~~powershell
# Local API
Invoke-WebRequest http://127.0.0.1:8085/healthz
Invoke-WebRequest http://127.0.0.1:8085/readyz

# Local cluster comparison
kubectl --context docker-desktop -n cloudsentinels-benchmark get deploy,pods,svc,resourcequota
kubectl --context cloudsentinels-local -n cloudsentinels-benchmark get deploy,pods,svc,resourcequota
kubectl --context docker-desktop top nodes
kubectl --context cloudsentinels-local top nodes

# Code checks
go test -race ./...
go vet ./...
pnpm --dir src/frontend typecheck
pnpm --dir src/frontend check
pnpm --dir src/frontend build
~~~
