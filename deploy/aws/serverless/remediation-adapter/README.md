# CloudSentinels dry-run remediation adapter

This adapter exists to validate the signed approval → SQS → remediation worker pipeline without changing infrastructure.

- Accepts only the worker's fixed action allowlist.
- Logs command metadata, not raw logs or secrets.
- Returns `accepted: true` with a deterministic `dry-run-<commandId>` execution ID.
- Always returns `recoveryVerified: false`.
- Never calls Kubernetes, AWS control-plane APIs, or another Lambda.

To enable the safe test path in the runtime stack, configure:
- `ZapierCommandSecretArn` with the HMAC signing secret for the callback.
- `RemediationExecutionEnabled=true`.
- `UseBuiltInDryRunAdapter=true`.

The worker and command receiver are created only when the command secret and execution gate are both present. The built-in adapter takes precedence over an external adapter ARN when selected. It is not a production remediation adapter. Replace it with a reviewed, commandId-idempotent adapter only after scoped RBAC, approval policy, and independent recovery verification are ready.

Run tests with `npm test` in this directory.
