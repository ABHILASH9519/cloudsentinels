# CloudSentinels + local n8n

The local n8n instance is an optional, independent automation destination. CloudSentinels continues to support Zapier; when both URLs are configured, the Go API fans each normalized event out to both receivers independently. A failure at one receiver does not prevent the other delivery.

## Local runtime

- Docker image: `n8nio/n8n:latest` (the existing pulled image is reused).
- Container: `n8n`, bound only to `127.0.0.1:5678`.
- Persistent storage: existing Docker volume `n8n_data` mounted at `/home/node/.n8n`.
- Editor: <http://localhost:5678>.
- Production webhook: `http://127.0.0.1:5678/webhook/cloudsentinels/events`.
- Time zone: `Asia/Kolkata`; restart policy: `unless-stopped`.

The workflow `CloudSentinels - Local Event Intake` is imported from `n8n-cloudsentinels-events.json` and published. It accepts POST events, validates `eventId` and `eventType`, retains only the CloudSentinels event allowlist, and classifies each event as `critical`, `degraded`, `recovery`, or `general`. Inspect its execution history in the n8n editor. The workflow does not execute Kubernetes mutations or call external services by default.

## Go API configuration

Keep these in the ignored repository-root `.env.local`:

```dotenv
N8N_WEBHOOK_URL=http://127.0.0.1:5678/webhook/cloudsentinels/events
N8N_SIGNING_SECRET=<separate random secret, at least 32 characters>
```

The Go dispatcher signs the exact JSON body with HMAC-SHA256 and sends `X-CS-Timestamp`, `X-CS-Signature`, and `X-CS-Event-ID`. The local listener is bound to loopback; do not expose port 5678 publicly. Zapier remains configured separately with `ZAPIER_CATCH_HOOK_URL` and `ZAPIER_SIGNING_SECRET`.

## Verification

With the local API running at `http://127.0.0.1:18080`, authenticate and POST to `/api/v1/n8n/test`. Zapier uses `/api/v1/zapier/test`. A successful API response confirms the receiver returned a successful HTTP response; inspect n8n execution history and the Zapier run history to confirm downstream actions.

The local n8n receiver is ready. Zapier code remains supported, but its Catch Hook URL must be created in the user's Zapier account before that destination can be live. Neither integration is allowed to perform cluster remediation; CloudSentinels policy and agent-side mutation flags remain authoritative.