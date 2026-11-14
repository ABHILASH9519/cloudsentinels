# Security Policy

## Authentication and authorization

Interactive users authenticate through Amazon Cognito OIDC. The Go API validates Cognito ID tokens (issuer, signature, expiry and app-client audience); protected routes fail closed when authentication is not configured. Never treat a frontend route guard as authorization.

Local development authentication is restricted to non-production environments and requires a high-entropy bearer token. Do not enable local-token authentication in production.

Kubernetes agents use dedicated bearer tokens, preferably one token per Airtable cluster record. Keep agent credentials in environment secrets or a secrets manager; never put them in frontend variables, manifests in source control, or logs.

## External integrations

- Airtable PATs are server-side only and must never be exposed through VITE_* variables.
- Zapier Catch Hook URLs and HMAC signing secrets are credentials. Verify timestamp freshness and HMAC signatures before accepting inbound commands.
- GitHub Actions uses the repository secret ZAPIER_WEBHOOK_ID for CI notifications. Never commit the webhook ID or full Catch Hook URL.
- AWS Lambda/automation workers should use least-privilege IAM roles and Secrets Manager references.

## Kubernetes command safety

The agent uses a fixed kubectl allowlist. Arbitrary shell commands, credential export, delete, scale, exec and apply are not supported. Mutating restart actions remain disabled by default and require an explicit human approval, server-side opt-in, agent-side opt-in, and namespace-scoped RBAC.

## Data durability and operational safety

The Go API's local command queue and telemetry cache are in-memory. Do not use them as durable production records or scale the API horizontally without moving these stores to durable infrastructure such as SQS/DynamoDB and adding persistent audit history.

Report suspected vulnerabilities privately to the repository owner rather than publishing exploit details in an issue.
