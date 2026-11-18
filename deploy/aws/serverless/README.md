# CloudSentinels — switchable AWS + ICP architectures

This branch contains **Option 1: AWS-native**. The existing ICP implementation remains on `main`; the separate Clerk + ICP experiment remains on its own branch. Nothing here deletes or rewrites those architectures. See [architecture switching](../../../docs/architecture-switching.md) for switching the source branch between ICP and AWS.

## On-demand operating model

AWS is split into two CloudFormation stacks so that you can use the app when needed without recreating your identity or data every session:

| Layer | Stack | Lifecycle | Resources |
|---|---|---|---|
| Persistent foundation | `cloudsentinels-core` | Deploy once; keep | DynamoDB table plus retained legacy Cognito resources |
| Runtime | `cloudsentinels-runtime` | Deploy once; pause/resume | API Gateway HTTP API and Lambda |

**Important:** Lambda is serverless; it has no continuously running VM. When paused, this setup sets reserved concurrency to `0`, blocking Lambda execution. Resuming removes that concurrency override. This keeps the API URL stable, so you do not need to rebuild the frontend or change Vercel environment variables every time you switch the runtime on and off.

The pause does not delete data, user accounts, API Gateway, Lambda code, or CloudFormation stacks. API Gateway requests can still incur request charges while paused, so close the app/browser and stop external polling while it is off.

## Architecture

- **Authentication:** Firebase Authentication (Google and Email/Password). The frontend obtains Firebase ID tokens; Firebase project ID is configured in the runtime JWT authorizer.
- **API:** API Gateway HTTP API JWT authorizer validates the Firebase issuer `https://securetoken.google.com/<project-id>` and Firebase project ID audience.
- **Application backend:** Node.js Lambda reads the verified Firebase `sub` claim from API Gateway context; it does not trust a user ID supplied by the browser.
- **Data:** DynamoDB single table with per-user partition keys `PK=USER#<sub>`; table uses on-demand billing and server-side encryption.
- **Automation:** EventBridge routes API and cluster-agent events to SQS. The automation processor classifies supported Kubernetes signals. Zapier can receive event notifications, apply filters and human approval, then return a timestamped HMAC-signed command to the AWS API. AWS validates the pending event and queues the approved command. A separate worker invokes a configured remediation adapter only when the adapter ARN and explicit execution opt-in are both set.
- **Safety:** The DynamoDB table and legacy Cognito foundation have CloudFormation `Retain` policies. The current Firebase-auth runtime does not use the retained Cognito user pool. The runtime can be paused without deleting persistent data.

## Requirements

Windows PowerShell 7 (or Windows PowerShell 5.1), AWS CLI v2, and an AWS account configured with `aws configure` or an AWS SSO profile. AWS SAM CLI and Docker are not required: the start script packages Lambda code with `aws cloudformation package`. The caller needs permission to upload artifacts to the private S3 bucket and pass the scoped `CloudSentinelsDeploymentRole`; CloudFormation assumes that role to provision the stacks.

## First start

From the repository root, open PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\deploy\aws\serverless\scripts\aws-on.ps1 -Region ap-south-1 -AppOrigin "https://YOUR-VERCEL-DOMAIN" -CognitoDomainPrefix "legacy-cognito-prefix" -FirebaseProjectID "your-firebase-project-id"
```

Use the exact deployed Vercel origin, with no path or trailing slash. `CognitoDomainPrefix` is retained only because the persistent core template still preserves legacy Cognito resources; those resources are not used by the current Firebase-auth runtime. Set `FirebaseProjectID` to the exact Firebase project ID used by the Web App. The script refuses root AWS credentials and requires a non-root deployment identity with permission to pass the scoped CloudFormation execution role. The script:
1. Verifies AWS credentials.
2. Creates/updates the persistent DynamoDB foundation and retains the legacy Cognito resources.
3. Creates/updates the API Gateway + Lambda runtime.
4. Resumes Lambda execution.
5. Prints the frontend configuration values.

After the first successful start, configure the printed outputs in Vercel Project → Settings → Environment Variables for the active Preview branch (currently `feat/airtable-cluster-monitoring-zapier`) and locally in `src/frontend/.env.local` if required. Use the exact AWS API URL and region from the deployed runtime stack. Obtain the four Firebase values from the registered Firebase Web App; the project ID must match `FirebaseProjectID` passed to the runtime deployment. Set the Go API origin and four Firebase Web App values below, then create a fresh Preview deployment because Vite embeds `VITE_*` values at build time:

- `VITE_CLOUDSENTINELS_API_URL` — exact HTTPS origin of a separately deployed, compatible CloudSentinels Go API

**API compatibility warning:** the `aws-on.ps1` script in this directory deploys the AWS API Gateway + Node.js Lambda runtime. Its `ApiBaseUrl` output is not the Go API origin and does not implement the frontend client's `/api/v1/incidents` route contract. Do not copy that AWS URL into `VITE_CLOUDSENTINELS_API_URL`. The current frontend requires the Go API; deploy that service separately and configure this variable only after its `/healthz` and authenticated `/api/v1` routes have been verified. The AWS Lambda runtime remains a separate backend architecture until an explicit API adapter is implemented.
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

These are public browser configuration values, not secrets. Never put AWS access keys, Firebase Admin private keys, or other credentials in `VITE_*` variables. The current frontend uses `VITE_CLOUDSENTINELS_API_URL` for the Go API origin; it does not read `VITE_AWS_API_URL` or `VITE_AWS_REGION`. In Firebase Authentication, enable the intended providers and add the exact Vercel preview/production hostnames to Authorized domains.
## Daily start / stop

Start or resume:

```powershell
.\deploy\aws\serverless\scripts\aws-on.ps1 -Region ap-south-1 -AppOrigin "https://YOUR-VERCEL-DOMAIN" -CognitoDomainPrefix "legacy-cognito-prefix" -FirebaseProjectID "your-firebase-project-id"
```

Pause after use:

```powershell
.\deploy\aws\serverless\scripts\aws-off.ps1 -Region ap-south-1
```

Check status:

```powershell
.\deploy\aws\serverless\scripts\aws-status.ps1 -Region ap-south-1
```

The start command is safe to repeat. It updates the stacks when the templates change and deploys the automation processor along with the API runtime. The stop command sets Lambda reserved concurrency to zero; it does not delete the runtime stack or change the API URL. The start and stop scripts reject root credentials.

## Costs and data safety

- There is no EC2 instance or continuously running container in this architecture.
- Lambda compute is billed on invocations/runtime; a concurrency pause blocks Lambda execution.
- HTTP API is request-billed, so requests while paused may still cost money. Close the app and stop polling.
- DynamoDB uses on-demand request billing, but stored data remains and storage can incur ongoing charges.
- Cognito usage can incur charges depending on monthly active users and the selected pricing tier.
- SAM may create a deployment artifact S3 bucket with `--resolve-s3`; it is retained for future deployments and can incur small storage charges.
- No cost is guaranteed to be zero. Check AWS Billing/Cost Explorer and configure a budget alert before regular use.

The core stack is intentionally retained. Do not delete it as a normal stop action. Deleting or replacing the persistent foundation is a separate data/identity migration operation and is not automated by these scripts.

## Optional workflow automation

See [n8n / Zapier automation](../../automation/README.md) for the EventBridge → SQS event path, and [Zapier self-healing setup](../../../docs/zapier-self-healing-setup.md) for the Catch Hook → human approval → signed AWS command workflow and adapter contract. The command endpoint can queue approvals without enabling cluster changes; live remediation remains off until a real adapter is deployed and explicitly enabled.

## AWS server and Lambda monitoring

See [AWS monitoring integration](../monitoring/README.md) for read-only monitoring of the existing EC2 server in eu-north-1 and the deployed Operations/AutomationProcessor Lambda functions in ap-south-1. It forwards EC2 state and CloudWatch alarm events into the authenticated automation activity feed, with SQS retries and dead-letter queues. Deployment is a separate additive CloudFormation operation; it does not start/stop EC2 or execute remediation.

## Current API

- `GET /health` — unauthenticated health probe.
- `GET /me` — authenticated Firebase identity summary.
- `GET|POST /incidents`
- `GET|PATCH|DELETE /incidents/{id}`
- `POST /incidents/{id}/analyze` — user-triggered, redacted incident analysis through Amazon Bedrock.
- `GET|POST /incidents/{id}/comments`
- `GET|POST /alerts`
- `PATCH /alerts/{id}`
- `GET|POST /metrics`
- `GET /automation/events` — authenticated, owner-scoped automation processing history.
- `POST /telemetry/events` — HMAC-authenticated cluster-agent ingestion; requires `ClusterAgentSecretArn`.

AI analysis uses the India-geographic Bedrock profile `in.anthropic.claude-sonnet-5` and runs only when a signed-in user requests it. Incident title, source, severity, and a redacted/truncated raw-log excerpt are sent to Bedrock; each request may incur model-inference charges. All application endpoints except health require a valid Firebase ID token validated by the API Gateway JWT authorizer. This is the AWS backend foundation; remaining application features/integrations must be validated before production use.


## GitHub Actions preview deployment

A manual, OIDC-based deployment workflow is available at `.github/workflows/aws-deploy-preview.yml`. It validates and tests the Lambda packages, builds the SAM template, assumes a dedicated GitHub Actions IAM role, updates only the existing runtime stack, and checks the API health endpoint. It does not run on every push and does not deploy production.

Before using it, configure the repository's `preview` GitHub environment and the scoped AWS roles described in [GitHub Actions AWS deployment setup](../../../docs/aws-github-oidc-deployment.md). Do not use root credentials or store long-lived AWS keys in GitHub.
