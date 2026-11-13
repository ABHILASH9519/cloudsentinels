# CloudSentinels architecture

## Active Go-first architecture

Go owns the core HTTP API, Airtable inventory adapter, monitoring/analysis endpoints, Kubernetes agent and AWS Lambda adapter. React + TypeScript is the browser presentation layer. Amazon Cognito authenticates users; Kubernetes agents use per-cluster bearer credentials.

AWS API Gateway, Lambda, DynamoDB, EventBridge, SQS and Secrets Manager provide hosted runtime and durable integration services. The deployed Operations Lambda still contains Node.js incident/alert/profile handlers, and the event-relay/automation workers are Node.js. Porting those deployed handlers to Go remains an explicit migration task; the standalone Go Lambda adapter is built but not yet active in the deployed stack.

## Execution modes

1. Online server: persistent Go HTTP API hosted on EC2 or another container runtime; it brokers commands to connected agents.
2. Online serverless: Go Lambda adapter behind API Gateway for stateless inventory, monitoring and analysis routes. The persistent agent command broker must remain on a durable online service until its queue is backed by SQS/DynamoDB.
3. Local/remote Kubernetes: Go agent reads a configured Kubernetes context and sends authenticated telemetry outbound to the Go API.

## Identity and data boundaries

A Cognito sub is the application identity. Cluster IDs are Airtable record IDs and must remain stable between local and EKS deployments. Airtable inventory data is not equivalent to live cluster telemetry. Never infer credentials or cluster endpoints from ordinary Airtable fields.

## Legacy platform removal

The Motoko/Internet Computer canister, Internet Identity flow, generated Candid bindings, and ICP build/deploy pipeline have been removed from the active project. The current deployment path is Go + AWS + Kubernetes.
