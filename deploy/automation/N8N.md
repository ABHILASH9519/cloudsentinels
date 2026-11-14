# CloudSentinels + local n8n

The local n8n instance is an optional, independent automation destination. CloudSentinels continues to support Zapier; when both URLs are configured, the Go API fans each normalized event out to both receivers independently. A failure at one receiver does not prevent the other delivery.

## Local runtime

- Docker image: `n8nio/n8n:latest` (the existing pulled image is reused).
- Container: `n8n`, bound only to `127.0.0.1:5678`.
- Persistent storage: existing Docker volume `n8n_data` mounted at `/home/node/.n8n`.
- Editor: <http://localhost:5678>.
- Production webhook: `http://127.0.0.1:5678/webhook/cloudsentinels/events`.
- Time zone: `Asia/Kolkata`; restart policy: `unless-stopped`.

## Workflow

`CloudSentinels - Event Triage and Routing` is active and imported from `n8n-cloudsentinels-events.json`.

1. **Webhook intake** accepts the normalized CloudSentinels POST event.
2. **Validate and Normalize Event** requires `eventId` and `eventType`, bounds key text fields, allowlists event fields, normalizes severity, classifies the route, and carries the delivery headers' presence as diagnostic metadata.
3. **Critical Event?** routes critical/offline/not-ready events to **Prepare Critical Alert** (P1, on-call/incident/email destinations recommended, human review required).
4. **Degraded Event?** routes high/warning/medium degradation events to **Prepare Degraded Alert** (P2, operations channel recommended, human review required).
5. **Recovery Event?** routes recovery/online/healthy events to **Prepare Recovery Notice** (P3, operations channel recommended).
6. All remaining events reach **Prepare General Audit Event** (P4).

Each branch produces a structured triage record in the n8n execution output. This makes routing testable now and provides a clean hand-off contract for notification integrations. No Slack, Teams, email, ticketing, or other external destination credentials were supplied, so the branch nodes prepare (but do not dispatch) notifications. The workflow never runs Kubernetes mutations or remediation.

**Security note:** the Go dispatcher signs requests with HMAC-SHA256 and sends `X-CS-Timestamp`, `X-CS-Signature`, and `X-CS-Event-ID`. The current workflow records whether the signature headers are present; it does not independently verify the HMAC. Keep n8n bound to loopback and do not expose port 5678 publicly. Do not treat header presence as cryptographic authentication.

## Go API configuration

Keep these in the ignored repository-root `.env.local`:

```dotenv
N8N_WEBHOOK_URL=http://127.0.0.1:5678/webhook/cloudsentinels/events
N8N_SIGNING_SECRET=<separate random secret, at least 32 characters>
```

Zapier remains configured separately with `ZAPIER_CATCH_HOOK_URL` and `ZAPIER_SIGNING_SECRET`. A Zapier Catch Hook URL must be created in the user's Zapier account before that destination can be live.

## Verification

With the local API running at `http://127.0.0.1:18080`, authenticate and POST to `/api/v1/n8n/test`. Zapier uses `/api/v1/zapier/test`. A successful API response confirms the receiver returned a successful HTTP response. Inspect n8n execution history to confirm which branch completed and inspect the branch's triage output.

The workflow is read-only with respect to clusters. CloudSentinels policy and agent-side mutation flags remain authoritative.
