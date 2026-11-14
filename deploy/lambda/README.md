# Go serverless adapter

This directory packages the shared Go HTTP API behind API Gateway HTTP API + AWS Lambda using the provided.al2023 custom runtime.

## Build and deploy

Requirements: AWS SAM CLI, Docker (for SAM build), an AWS account/role with permissions for Lambda, API Gateway, IAM, CloudFormation, CloudWatch Logs and Secrets Manager.

From the repository root:

```powershell
sam build --template-file deploy/lambda/template.yaml
sam deploy --guided --template-file .aws-sam/build/template.yaml
```

Supply the Cognito issuer/client ID and HTTPS frontend origin. Create separate Secrets Manager secrets:
- Airtable JSON secret: `{"token":"<Airtable PAT>"}`
- Zapier JSON secret: `{"catchHookUrl":"<Zapier Catch Hook URL>","signingSecret":"<32+ random characters>"}`

CloudFormation resolves Secrets Manager dynamic references into encrypted Lambda environment variables during deployment. The deployment identity needs permission to read the supplied secret ARNs; the Lambda execution role does not receive broad secret access. Rotation requires updating the stack. Secrets are never VITE_ variables or source files.

## Serverless boundaries

- The Lambda adapter shares the Go inventory, incident API and explainable analysis implementation.
- Airtable inventory is refreshed at cold start from the private PAT; the packaged sanitized snapshot is the fallback.
- Zapier receives high/critical cluster findings from the explicit `POST /api/v1/ai/analyze` endpoint and outbound incident events.
- Local CLI command queue and local agent telemetry are intentionally not available in this stateless adapter. Route local CLI commands through the persistent online-server control plane.
- The Lambda bootstrap uses the same Cognito ID-token verification and CORS allowlist as the Go server.
- This template has not been deployed from the connected desktop because AWS CLI identity/region and deployment permissions are not configured here.
