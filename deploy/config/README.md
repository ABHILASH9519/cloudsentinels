# Configuration templates

| File | Consumer |
|---|---|
| [Root local environment](../../.env.floci.example) | Docker Compose and the two workstation agents |
| [Go API environment](../../.env.example) | Standalone control plane |
| `agent.env.example` | A dedicated host agent |
| `aws.env.example` | AWS deployment inputs |
| `aws-cli-config.example` | AWS CLI named profile |
| `samconfig.example.toml` | Optional Go Lambda SAM deployment settings |
| `eks-parameters.example.json` | EKS review-day template parameters |
| `netlify.toml.example` | Optional static dashboard hosting |
| [Dashboard environment](../../src/frontend/.env.example) | Vite build-time public settings |

Use private local copies of environment files with restrictive permissions. Populate credentials through the relevant secret manager or generated local keys. CloudFormation templates use their declared parameters and the deployment scripts accept them explicitly. These examples do not provision any resources.
