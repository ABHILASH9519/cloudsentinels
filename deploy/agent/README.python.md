# Legacy Python cluster telemetry agent

This read-only Kubernetes Warning-event collector belongs to the existing AWS Node/Python event-processing track. It is preserved separately while the new Go desktop/cluster agent is developed.

Supported signals include CrashLoopBackOff, NodeNotReady, OOMKilled, Evicted, MemoryPressure, Unhealthy, FailedScheduling and FailedCreate. It does not perform remediation.

The agent signs event payloads using the legacy AWS `POST /telemetry/events` contract, keyed by cluster ID and a per-cluster Secrets Manager secret. This is separate from the new Go agent API and Zapier HMAC command contract.

Build from repository root:

```powershell
docker build -f deploy/agent/Dockerfile.python -t cloudsentinels-python-agent:local .
python3 -m unittest discover -s deploy/agent -p 'test_*.py'
```

The legacy deployment template is `deploy/agent/cluster-agent-deployment.template.yaml`. Do not apply it to EKS without reviewing the AWS track's API, secret ARN, RBAC, namespace, image and event contract. The Go agent is documented in [README.md](README.md).
