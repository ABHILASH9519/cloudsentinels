# Build and deployment inventory

The repository contains a prepared source distribution. Each profile has a separate entry point and can be configured independently when time and infrastructure are available.

| Profile | Assets | Future entry point |
|---|---|---|
| Floci local microservices | [Compose](../compose.yaml), [Go Dockerfile](../Dockerfile), [bridge Dockerfile](../deploy/local/Dockerfile), [dashboard Dockerfile](../deploy/local/Dashboard.Dockerfile), [local environment](../.env.floci.example) | `./run.sh up` / `./run.ps1 -Action Up` |
| Native Go binaries | [portable artifact builder](../scripts/build-artifacts.py), [Go module](../go.mod), [module checksums](../go.sum) | `./run.sh build --frontend` / `./run.ps1 -Action Build -Frontend` |
| Kubernetes agent | [container definition](../deploy/agent/Dockerfile), [manifests](../deploy/agent/kubernetes), [agent environment](../deploy/config/agent.env.example) | Existing workstation runner or reviewed cluster manifest application |
| Linux native services | [systemd units](../deploy/systemd) | Install binaries and private service environments, then enable the desired units |
| AWS EKS | [CloudFormation template](../deploy/eks/review-day-cluster.yaml), [parameter example](../deploy/config/eks-parameters.example.json) | Review parameters and use the [prepared review workflow](legacy/workflows/eks-review-day.yml) as reference |
| AWS Go Lambda | [SAM template](../deploy/lambda/template.yaml), [SAM configuration example](../deploy/config/samconfig.example.toml), [Makefile](../Makefile) | Build with SAM and review the deploy change set |
| AWS Node.js operations | [core and runtime templates](../deploy/aws/serverless), [AWS env](../deploy/config/aws.env.example), locked package manifests | Existing `aws-on.ps1` accepts explicit region, origin, Firebase project and roles |
| AWS monitoring bridge | [EventBridge, SQS and CloudWatch templates](../deploy/aws/monitoring), [bridge scripts](../deploy/automation) | Select AWS profile and configure queue and poller |
| n8n / Zapier | [workflow JSON](../deploy/automation/n8n-cloudsentinels-unified.json), [catalog](../deploy/automation/catalog), [Zapier setup](../deploy/automation/ZAPIER.md) | Import n8n workflow or configure the authorized Zapier webhook |
| Static dashboard hosting | [Netlify example](../deploy/config/netlify.toml.example), [frontend public variables](../src/frontend/.env.example), [pnpm lockfile](../pnpm-lock.yaml) | Configure an HTTPS backend and Firebase settings before deploying only the dashboard |

## Artifact layout

The compile-only entry point produces the following files when invoked with the documented toolchain:

- `artifacts/linux-amd64/` and `artifacts/linux-arm64/` — API and agent binaries.
- `artifacts/windows-amd64/` — native Windows `.exe` binaries.
- `artifacts/darwin-arm64/` — macOS Apple Silicon API and agent.
- `artifacts/lambda-arm64/bootstrap` and `artifacts/cloudsentinels-lambda-arm64.zip` — Lambda custom-runtime executable, inventory and ZIP archive.
- `src/frontend/dist/` — optional compiled static dashboard.

Toolchain requirements are Go 1.23+, Python 3.11+, Node 22+ and pnpm, plus Docker Compose v2 and kubectl for the local operational profile. The Python bridge dependencies are declared in [requirements.txt](../deploy/local/requirements.txt); AWS JavaScript packages retain their individual package-lock files. Dependency caches and native build outputs are intentionally excluded from source control. Build outputs are platform-specific and generated on demand.

The source preparation commit only adds configuration, build recipes, executable launch scripts, and architecture assets. No new environment was provisioned, no compile or test command was invoked for this commit, and no compiled executable or image is claimed to exist from this change. Earlier CI results remain available in the repository.
