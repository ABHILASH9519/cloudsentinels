# Local CloudSentinels environment

This setup reuses the existing Minikube profile `cloudsentinels-local` on Docker Desktop. It does not create an EKS cluster and does not mutate Airtable records.

## Start order

Open separate PowerShell terminals from the repository root:

1. Start or verify Minikube:

   ```powershell
   .\deploy\local\setup-minikube.ps1
   ```

2. Start the Go API:

   ```powershell
   .\deploy\local\start-api.ps1
   ```

3. Start the read-only Kubernetes agent:

   ```powershell
   .\deploy\local\start-agent.ps1
   ```

The API binds to `127.0.0.1:18080` because another local service already occupies port 8080. The agent reports every 30 seconds and keeps mutation execution disabled.

## Local configuration

The scripts load the private repository-root `.env.local`. Required keys:

- `CLOUDSENTINELS_LOCAL_AUTH_TOKEN` — local API operator token (development only).
- `CLOUDSENTINELS_AGENT_TOKEN` — desktop-agent authentication token.
- `ZAPIER_SIGNING_SECRET` — generated locally; used after a Catch Hook URL is configured.
- `ZAPIER_CATCH_HOOK_URL` — blank until a Zapier Catch Hook is created.

Both Zapier and n8n receive the same normalized CloudSentinels event envelope independently; failure of one delivery does not block the other. Use `/api/v1/zapier/test` and `/api/v1/n8n/test` to verify each configured receiver. The n8n editor is local at `http://localhost:5678`. Do not commit `.env.local` or paste its values into chat. Production authentication still requires the Firebase project configuration. Live Airtable refresh still requires a server-side Airtable PAT; until then the API uses the checked-in sanitized snapshot, which was verified against all 20 current Airtable cluster records and their allowlisted fields.

## Safety boundaries

- The desktop agent uses read-only Kubernetes queries.
- `CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS=false` is set by the start script.
- The local cluster is a separate telemetry target; it is not mapped to an Airtable production record.
- The checked-in Airtable inventory snapshot remains read-only and source records are not changed.
