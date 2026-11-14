# CloudSentinels development and deployment workflow

CloudSentinels uses one Go-first backend architecture on the active feature branch. The React/TypeScript application is the browser UI; Go is the core HTTP API, Kubernetes agent and Lambda adapter. AWS-specific event relay/automation workers remain supporting services.

## Work on the active branch

```powershell
git status
git branch --show-current
```

The current feature branch is `feat/airtable-cluster-monitoring-zapier`. Keep local changes committed or stashed before switching branches. A Git branch switch changes source files only; it does not deploy, stop, or delete cloud resources.

## Local operations

- Start the Cognito-authenticated Go API and React frontend with `scripts/start-local-server.ps1`.
- Start the Docker-backed local Kubernetes cluster and Go agent with `scripts/kubernetes/start-local-cluster.ps1`.
- Stop local API/frontend/agent processes with `scripts/stop-local-server.ps1`. The Minikube cluster remains running.

## AWS operations

The AWS core stack (Cognito + DynamoDB) is separate from the runtime stack (API Gateway + Lambda). Use the scripts in `deploy/aws/serverless/scripts/` to inspect or pause runtime resources. Do not delete the core stack as a routine shutdown action. Pausing Lambda is not the same as deleting infrastructure; API Gateway requests may still be billed while paused.

## Important distinction

A Git branch switch does not automatically update a Vercel site or provision/deprovision cloud services. Verify the deployment branch, environment variables, AWS stack outputs and current workflow run before treating a source change as deployed.
