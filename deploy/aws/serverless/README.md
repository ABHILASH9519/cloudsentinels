# CloudSentinels — AWS-native architecture

This is **Option 1**. It replaces Internet Identity and ICP canisters for this deployment with Amazon Cognito, API Gateway HTTP API, AWS Lambda, and DynamoDB. The existing ICP implementation remains on `main` and is not deleted or rewritten by this branch.

## Architecture

- **Authentication:** Cognito User Pool, email sign-in, verified email, hosted UI OAuth authorization-code flow with PKCE (browser app client has no client secret).
- **API:** API Gateway HTTP API JWT authorizer validates Cognito issuer and audience before requests reach Lambda.
- **Application backend:** Node.js Lambda reads the verified Cognito `sub` claim from API Gateway context. It never trusts a user ID supplied in the request body.
- **Data:** DynamoDB single table. Every item is keyed under `PK=USER#<sub>`; all reads and writes use the authenticated subject in the partition key.
- **Storage/operations:** This initial stack does not provision S3, CloudWatch alarms, or AI model integrations; those can be added after the AWS base is deployed and tested.

## Deploy

Prerequisites: AWS CLI, AWS SAM CLI, Docker (for SAM build), and an AWS account with permission to create Cognito, API Gateway, Lambda, IAM, and DynamoDB resources.

1. Choose the AWS region and a globally unique Cognito domain prefix.
2. Deploy the stack:
   ```bash
   cd deploy/aws/serverless
   sam build
   sam deploy --guided
   ```
3. Set `AppOrigin` to the exact HTTPS origin where the frontend is hosted (no path), and `CognitoDomainPrefix` to the unique prefix.
4. Save the stack outputs: `UserPoolId`, `UserPoolClientId`, `CognitoIssuer`, `CognitoHostedUi`, and `ApiBaseUrl`.
5. Configure the frontend's `VITE_AWS_REGION`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_DOMAIN`, and `VITE_AWS_API_URL` values. These are public client configuration values, not secrets.
6. Configure the Vercel frontend environment and redeploy.

No AWS resources are created by committing this template. Review the SAM change set and estimated charges before deploying.

## Current API

- `GET /health` — unauthenticated health probe.
- `GET /me` — authenticated Cognito identity summary.
- `GET|POST /incidents`
- `GET|PATCH|DELETE /incidents/{id}`
- `GET|POST /incidents/{id}/comments`
- `GET|POST /alerts`
- `PATCH /alerts/{id}`
- `GET|POST /metrics`

All application endpoints except health require a valid Cognito JWT. User-owned records are partitioned by verified Cognito subject. This is an initial AWS backend foundation; remaining application operations and UI wiring are tracked separately rather than being represented as complete.
