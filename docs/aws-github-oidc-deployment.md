# GitHub Actions deployment for the AWS preview runtime

The workflow at [../.github/workflows/aws-deploy-preview.yml](../.github/workflows/aws-deploy-preview.yml) provides a **manual, preview-only** deployment path for the existing cloudsentinels-runtime stack. The current runtime uses Firebase Authentication JWTs; the Cognito resources retained in the persistent core stack are legacy identity resources and are not the authorizer for this branch.

It does not deploy on every push, modify the persistent Cognito/DynamoDB foundation, create a production stack, or enable the optional Zapier relay. A maintainer must deliberately run it from GitHub Actions. The job runs the Lambda test suites and SAM validation/build before requesting AWS credentials. It updates the runtime JWT authorizer from the previous Cognito issuer to `https://securetoken.google.com/<FIREBASE_PROJECT_ID>` and adds the current automation/telemetry routes.

## Required GitHub environment configuration

Create a GitHub Actions environment named preview in the repository settings. Protect it with required reviewer approval and deployment branch restrictions. Add these environment variables:

| Name | Value |
|---|---|
| AWS_REGION | ap-south-1 |
| AWS_ACCOUNT_ID | The AWS account ID that owns the existing preview stacks |
| AWS_APP_ORIGIN | The exact HTTPS Vercel preview origin allowed by the runtime API CORS configuration |
| FIREBASE_PROJECT_ID | Firebase project ID used as the API Gateway JWT issuer and audience; must match the Vercel `VITE_FIREBASE_PROJECT_ID` |
| CLOUDFORMATION_EXECUTION_ROLE_ARN | The scoped CloudFormation service role used by the existing runtime stack |
| ZAPIER_WEBHOOK_SECRET_ARN | Optional Secrets Manager ARN containing the outbound Zapier Catch Hook URL and signing secret |
| ZAPIER_COMMAND_SECRET_ARN | Optional Secrets Manager ARN for the inbound Zapier command signature secret |
| REMEDIATION_ADAPTER_FUNCTION_ARN | Optional ARN of the separately deployed remediation adapter Lambda |
| REMEDIATION_EXECUTION_ENABLED | Keep false until the adapter is tested; set true only for an approved non-production rollout | 
| USE_BUILT_IN_DRY_RUN_ADAPTER | Default false; set true only to test the approval queue using the built-in adapter that never mutates infrastructure |
| CLUSTER_AGENT_SECRET_ARN | Optional Secrets Manager ARN containing the HMAC cluster registry JSON; see [the agent guide](../deploy/agent/README.md) |

Add this environment secret:

| Name | Value |
|---|---|
| AWS_DEPLOY_ROLE_ARN | ARN of a dedicated IAM role trusted by GitHub Actions OIDC |

Do not store AWS access keys, session tokens, or webhook secrets in GitHub variables or source files. The workflow expects short-lived credentials through OIDC.

## AWS OIDC trust

Create/configure the GitHub Actions OIDC provider in IAM if it does not already exist:

- Provider URL: https://token.actions.githubusercontent.com
- Audience: sts.amazonaws.com

The dedicated GitHub deployment role trust policy should restrict the subject to this repository's preview environment. Replace the account ID only in the AWS role ARN when creating the role; do not broaden the subject to all repositories or branches.

~~~json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:ABHILASH9519/cloudsentinels:environment:preview"
      }
    }
  }]
}
~~~

The GitHub OIDC role needs only the deployment permissions for the preview runtime: read the named core/runtime CloudFormation stacks and their outputs; create, inspect, execute and delete CloudFormation change sets for the runtime stack; upload/read/list SAM artifacts in the private cloudsentinels-sam-artifacts-ACCOUNT_ID bucket; call sts:GetCallerIdentity; and iam:PassRole only for the configured CloudFormation execution role. Scope resources to the exact account, region, stack, bucket and role where the AWS API supports resource-level permissions. Do not grant IAM administration or unrestricted iam:PassRole.

The CloudFormation execution role is a separate role assumed by CloudFormation. It must trust cloudformation.amazonaws.com and have the resource permissions required by the runtime template. The GitHub OIDC role should not be the CloudFormation execution role.

## Run a preview deployment

1. Confirm the GitHub preview environment variables and OIDC secret are set and branch restrictions include the branch selected for the manual run.
2. Confirm the artifact bucket exists, is private, and has encryption enabled.
3. Open Actions → Deploy CloudSentinels AWS preview → Run workflow.
4. Select the branch containing the workflow and the reviewed runtime template. For the current reviewed architecture, select `feat/airtable-cluster-monitoring-zapier`; do not select the base branch unless it contains the same reviewed workflow and template.
5. Review the workflow result and its API /health smoke test.

The job refuses to continue if the caller account differs from AWS_ACCOUNT_ID, the persistent core stack is not in a stable complete state, required outputs are missing, or the artifact bucket is unavailable.

## Deployment boundaries

- This is a preview runtime deployment only. There is no production target in this workflow.
- The workflow updates only cloudsentinels-runtime; it reads the existing cloudsentinels-core outputs and does not change Cognito users or the DynamoDB table definition.
- It leaves the outbound ZapierWebhookSecretArn unset unless separately configured. The inbound ZapierCommandSecretArn, adapter ARN, and execution flag are passed from the optional GitHub environment variables above.
- The HMAC telemetry route is disabled until CLUSTER_AGENT_SECRET_ARN is configured; the route is separate from Cognito and validates cluster ID, timestamp, and request signature.
- The outbound Zapier relay is created only when ZAPIER_WEBHOOK_SECRET_ARN is set. The inbound Zapier command endpoint is HMAC-authenticated and checks the event's approval state and recommended action before queuing a command.
- The remediation worker is provisioned only when the command secret and REMEDIATION_EXECUTION_ENABLED=true are configured together with either a reviewed external adapter ARN or USE_BUILT_IN_DRY_RUN_ADAPTER=true. The adapter itself must enforce Kubernetes RBAC and idempotency and independently verify recovery.
- Without a real, tested adapter, the AWS processor only classifies/records events and the command queue has no live cluster action. Do not describe the system as live self-healing.
- The health endpoint confirms API availability, not authenticated end-to-end application behavior or successful downstream event processing.
- The workflow is intentionally manual. Pushing code commits does not deploy AWS resources.

## Current access limitation

A deployment must use the dedicated GitHub OIDC role and scoped CloudFormation execution role. Do not use root credentials for CI/CD or interactive deployment. If those roles/environment values are not configured, the workflow will stop before modifying AWS resources.

## Firebase frontend configuration for the current preview branch

The Vercel project `devops` is connected to this repository. For the `feat/airtable-cluster-monitoring-zapier` Preview branch, configure these public Firebase Web App variables in Vercel:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

`VITE_FIREBASE_PROJECT_ID` must equal the GitHub preview environment variable `FIREBASE_PROJECT_ID`. The `VITE_AWS_API_URL` and `VITE_AWS_REGION` variables are already configured for this branch. The Firebase values must come from the registered Firebase Web App; do not invent placeholders. Do not put a Firebase Admin service-account private key in Vercel or any `VITE_*` variable.

For the local Go API, keep the Firebase Admin service-account JSON outside the repository and set `GOOGLE_APPLICATION_CREDENTIALS` using `scripts/configure-firebase-local.ps1`. The hosted API Gateway validates Firebase ID tokens using its JWT authorizer and does not need the Admin private key in the browser.

## Current hosted migration blockers

The currently deployed `cloudsentinels-runtime` stack still has the old Cognito JWT authorizer and does not yet contain the `/automation/events` or `/telemetry/events` routes from the current template. Its Operations Lambda last-modified timestamp was observed as 2026-11-09. The current source template is Firebase-based and includes these routes; the manual preview workflow must be run successfully to update the hosted runtime.

The AWS account currently has no `token.actions.githubusercontent.com` IAM OIDC provider. The only configured OIDC providers are Vercel providers. The existing `CloudSentinelsDeploymentRole` trusts CloudFormation, not GitHub Actions, and must not be used as the GitHub caller role. Configure the dedicated GitHub OIDC provider, a repository/environment-restricted deploy role, and the separate scoped CloudFormation execution role before running the workflow. Do not use root credentials.