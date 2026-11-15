# Go serverless adapter

This directory packages the shared Go HTTP API behind API Gateway HTTP API + AWS Lambda using the `provided.al2023` custom runtime.

## Authentication contract

The frontend and Go API use **Firebase Authentication**. The browser sends a Firebase ID token as `Authorization: Bearer ...`; the Go Lambda verifies it with the Firebase Admin SDK. The Cognito parameters used by an earlier template did not match the current Go authenticator and have been removed from this Go Lambda template.

Create a Firebase Admin service-account JSON secret in AWS Secrets Manager. Supply its ARN as `FirebaseAdminSecretArn` and the matching project ID as `FirebaseProjectID`. Never place service-account JSON in source control, workflow JSON, browser `VITE_*` variables, or chat. The Firebase Web App's four public configuration values belong in the frontend build environment only.

## Build and deploy

Requirements: AWS SAM CLI, Docker (for `sam build`), an AWS account/role with permissions for Lambda, API Gateway, IAM, CloudFormation, CloudWatch Logs and read access to the specified Secrets Manager secret during deployment.

From the repository root:

```powershell
sam build --template-file deploy/lambda/template.yaml
sam deploy --guided --template-file .aws-sam/build/template.yaml
```

Required parameters:
- `FirebaseProjectID`: Firebase project ID.
- `FirebaseAdminSecretArn`: ARN of a Secrets Manager secret whose complete secret string is the Firebase Admin service-account JSON document.
- `AllowedOrigins`: exact HTTPS frontend origin.

Optional Secrets Manager secrets:
- Airtable JSON secret: `{"token":"<Airtable PAT>"}`
- Zapier JSON secret: `{"catchHookUrl":"<Zapier Catch Hook URL>","signingSecret":"<32+ random characters>"}`

CloudFormation resolves Secrets Manager dynamic references into encrypted Lambda environment variables during deployment. The deployment identity needs permission to read the supplied secret ARNs; the Lambda execution role does not receive broad secret access. Rotation requires updating the stack. The Admin credential remains server-side.

## Serverless boundaries

- The Lambda adapter shares the Go inventory, incident API, Firebase token verification and explainable analysis implementation.
- Airtable inventory is refreshed at cold start from the private PAT; the packaged sanitized snapshot is the fallback.
- Zapier receives configured outbound incident events.
- Local CLI command queue and local agent telemetry are intentionally not available in this stateless adapter. Route local CLI commands through the persistent online-server control plane.
- Kubernetes remediation is not enabled in this serverless API; mutating operations remain approval-gated in the online control plane.
- The template is a deployable package definition, not proof of deployment. Verify the stack and authenticated API endpoints after deployment.