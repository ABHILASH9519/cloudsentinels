# CloudSentinels review readiness ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â 16 November 2026

**Repository:** `ABHILASH9519/cloudsentinels`  
**Branch:** `feat/airtable-cluster-monitoring-zapier`  
**Preflight command:** `.\scripts\review\preflight.ps1` (read-only)

## Current status

The local development environment is operational, the hosted AWS foundation is deployed, and the frontend/API routing changes are committed. The project is **not yet production-ready** because Firebase configuration and the hosted runtime migration still require external setup and a non-root AWS deployment identity.

## Local environment ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â verified

| Component | Observed state |
|---|---|
| Go API `/healthz` | HTTP 200 |
| Go API `/readyz` | HTTP 503 until Firebase Admin credentials are configured |
| Frontend | HTTP 200 on `127.0.0.1:5173` |
| n8n | HTTP 200 on `127.0.0.1:5678` |
| Docker Desktop Kubernetes | `desktop-control-plane` Ready; 9 pods present |
| Minikube (`cloudsentinels-local`) | Node Ready; 9 pods present |
| Local cluster agents | Two agent processes running |
| Unified n8n workflow | Active; 15-node workflow in local n8n database |

The API liveness check is not the same as readiness. Firebase sign-in and protected Go API routes must not be presented as working until `/readyz` returns 200 and a real Firebase ID token passes `GET /api/v1/auth/me`.

## Hosted AWS ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â verified

| Component | Observed state |
|---|---|
| `cloudsentinels-core` | UPDATE_COMPLETE |
| `cloudsentinels-runtime` | UPDATE_COMPLETE, but deployed revision is older than current source |
| `cloudsentinels-n8n-bridge` | CREATE_COMPLETE |
| API Gateway `/health` | HTTP 200 |
| Operations Lambda | Active; last modified 9 November 2026 |
| AWS-to-n8n SQS queue | 6 visible messages, 0 in flight |
| EKS in `ap-south-1` | No cluster currently provisioned |
| Existing CloudSentinel EC2 server | Stopped; intentionally not started |

The currently deployed API Gateway still has the Cognito JWT authorizer and is missing `GET /automation/events` and `POST /telemetry/events`. The current repository runtime template uses the Firebase JWT authorizer and includes those routes. The live `/automation/events` endpoint currently returns 404. A successful `/health` response therefore does not establish that the full hosted application is current.

The hosted frontend preview for commit `d0c72b1` built successfully and is Ready: `https://devops-ipcww6l8v-abhilashs-projects-d66ddd5e.vercel.app` (Vercel preview protection may require the project owner to sign in). Its AWS API URL and region are configured for this branch. Firebase Web App configuration is still missing, so hosted sign-in is not yet verified. `aws-on.ps1` now requires `FirebaseProjectID`, deploys the current Firebase JWT template, and refuses root credentials. `aws-off.ps1` also refuses root credentials.

## Automated validation

- Go race tests, `go vet`, and backend/agent builds passed in the previous full validation run.
- Frontend Biome check, TypeScript typecheck, and Vite production build passed after the API routing fix.
- Operations Lambda test suite: 10/10 passed.
- The serverless Node suites previously passed 72/72 tests.
- All six GitHub Actions workflow YAML files parse successfully.
- Six CloudFormation templates passed `cfn-lint` in the earlier full validation run.

## Remaining release blockers

1. **Firebase:** supply the Firebase Web App `apiKey`, `authDomain`, `projectId`, and `appId`; register/enable the intended sign-in providers and authorized domains. For local Go API token verification, store the matching Firebase Admin service-account JSON outside the repository and run `scripts/configure-firebase-local.ps1`.
2. **Hosted AWS deployment identity:** the AWS account has no `token.actions.githubusercontent.com` IAM OIDC provider. The existing `CloudSentinelsDeploymentRole` trusts CloudFormation, not GitHub Actions. A dedicated repository/environment-restricted GitHub OIDC role and a separate scoped CloudFormation execution role are required before the manual preview deployment workflow can update the runtime.
3. **Hosted Firebase migration:** set the GitHub preview environment `FIREBASE_PROJECT_ID` to the same project as the Vercel `VITE_FIREBASE_PROJECT_ID`, then run the manual preview workflow and verify the Firebase JWT authorizer, `/automation/events`, `/telemetry/events`, and a real signed-in request.
4. **AWS-to-n8n event consumption:** the existing SQS-only policy is unattached. A dedicated non-root poller role is required before starting the local AWS poller. Do not run it as root; the six queued events have not been consumed.
5. **Review-day EKS:** no hosted EKS cluster exists yet. The manual `eks-review-day.yml` workflow requires the protected `minor-review` environment, GitHub OIDC role, CloudFormation execution role, fresh read-only Airtable inventory token, approved VPC/private subnets in distinct AZs, cluster/node/admin role ARNs, instance type, and a narrow public API CIDR allowlist. Use `operation=plan` first and review its change set before any execute operation.
6. **Remediation:** production mutation remains disabled by default. No live remediation has been executed. Keep it approval-gated until the adapter, RBAC, and recovery verification have been tested.

## Review-day operating boundaries

- Use the local Docker Desktop and Minikube clusters to inspect the current local multi-cluster integration.
- Use the hosted `/health` endpoint to show AWS API availability, but disclose that the hosted runtime is behind the current source revision.
- Do not claim Firebase sign-in, live AWS-to-n8n consumption, hosted EKS, or production self-healing are complete until the corresponding checks above pass.
- Do not start the stopped EC2 instance, create an EKS cluster, change IAM policies, consume the SQS queue, or execute remediation without the required approvals and least-privilege identity.
- Run `.\scripts\review\preflight.ps1` immediately before the review to refresh the local and hosted status.

## Latest commits

- `d0c72b1` - align AWS start/stop scripts with Firebase JWT runtime, reject root credentials, and add a read-only review preflight.
- `ba2f8b6` - correct frontend routing between hosted AWS API and local Go API; repair hosted deployment workflow YAML.
- `8768997` - add secure local Firebase configuration helper.
- `67334c8` - harden unified multi-cluster automation delivery.