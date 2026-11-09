# CloudSentinels architecture options

## Option 1 — AWS-native (active implementation branch)

Amazon Cognito authenticates users. API Gateway HTTP API validates JWTs. Lambda executes application operations and DynamoDB stores user-owned incidents, alerts, metrics, and comments. No ICP canister or Internet Identity dependency is required for this option.

Implementation lives in `deploy/aws/serverless/` and the `feat/aws-native-architecture` branch.

## Option 2 — ICP-native / hybrid (preserved)

The existing `main` branch continues to use Internet Identity and the Motoko backend canister. The Clerk + ICP gateway work remains separately available on `feat/clerk-authentication`. This option is not deleted, merged into the AWS path, or migrated automatically.

## Separation and data migration

These options use different identity namespaces. A Cognito `sub` is not an ICP Principal. Data is not automatically shared between DynamoDB and canister stable memory. Enabling both for the same users requires an explicit account-linking and data-migration design; do not assume email equality alone is sufficient proof of identity.
