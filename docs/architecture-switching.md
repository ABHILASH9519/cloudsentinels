# CloudSentinels architecture switching

CloudSentinels keeps the two backend implementations isolated so that one can be used without deleting the other.

## Select the code architecture

- **ICP / Internet Identity:** switch to `main`.
- **AWS-native / Cognito:** switch to `feat/aws-native-architecture`.

From the repository root:

```powershell
git status
git switch main
```

To return to AWS:

```powershell
git status
git switch feat/aws-native-architecture
```

Commit or stash local changes before switching branches. The branch switch changes the source tree; it does not deploy, stop, or delete cloud resources.

## Operate the AWS runtime

On the AWS branch, use:

- `deploy/aws/serverless/scripts/aws-on.ps1` — deploy/update the persistent foundation if needed, deploy/update the runtime, and resume Lambda.
- `deploy/aws/serverless/scripts/aws-off.ps1` — set Lambda reserved concurrency to zero, pausing application execution without deleting the API URL, Cognito users, or DynamoDB data.
- `deploy/aws/serverless/scripts/aws-status.ps1` — inspect stack and Lambda pause status.

The AWS core stack (Cognito + DynamoDB) is intentionally separate from the runtime stack (API Gateway + Lambda). Do not delete the core stack as a routine shutdown action. AWS pause is not the same as deleting infrastructure: API Gateway requests may still be billed while paused, so close the frontend and stop polling.

## Important distinction

Changing Git branches selects which implementation you build/run locally. It does not automatically switch an already deployed Vercel site or provision/deprovision cloud services. The AWS branch uses Cognito and its AWS API configuration; the ICP branch uses its existing Internet Identity/canister setup. Keep their environment variables separate in deployment environments.
