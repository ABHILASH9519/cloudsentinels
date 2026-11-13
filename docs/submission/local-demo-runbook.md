# CloudSentinels submission demo

This runbook starts the Go API and React dashboard in a local, authenticated demo profile. It does not require AWS Cognito or expose a credential in Git.

## Start

From the repository root in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local-demo.ps1
```

The script generates high-entropy local-only operator and agent tokens when needed, stores them in ignored `.env.local` files, starts both services, checks their health, and opens the browser.

- Dashboard / cluster inventory: http://localhost:5173/#/clusters
- Monitoring: http://localhost:5173/#/monitoring
- AI findings: http://localhost:5173/#/ai-insights
- API health: http://127.0.0.1:8082/healthz

Stop the processes started by the script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop-local-demo.ps1
```

## Demo walkthrough

1. Open Cluster Command and confirm that the 20 sanitized Airtable inventory records load.
2. Open Monitoring and inspect reported CPU/memory, cluster health and inventory provenance.
3. Open AI Insights and review the seven initial explainable findings.
4. Click **Run analysis** on Cluster Command or AI Insights; confirm the API returns the analysis report.
5. Show that the Online server is running, Online serverless is buildable but not deployed, and Offline Kubernetes remains disconnected until a real cluster agent reports.
6. Use the data freshness panel to explain that the inventory snapshot is not live telemetry.

## What this local profile does and does not prove

- The Go API, authenticated inventory routes, monitoring summary and deterministic analysis engine run locally.
- The dashboard uses the Go API and a local-only development authentication token.
- Inventory comes from the checked-in sanitized Airtable snapshot. Live Airtable refresh is unavailable until a server-side PAT is configured.
- The AI feature is an explainable rules engine, not a trained ML/LLM model.
- Kubernetes telemetry is real only after a reachable Kubernetes context and the Go agent are connected. A local Minikube VM could not start on this desktop because VT-x/AMD-v hardware virtualization is disabled in BIOS; the Docker Desktop service also requires elevated access.
- Zapier delivery requires the real Catch Hook URL and HMAC secret. Do not claim a notification was delivered when those are not configured.
- Serverless mode is a buildable Lambda adapter, not a deployed endpoint.
- Mutating remediation is disabled by default.

## Submission checklist

- [ ] Start the local demo from a clean terminal.
- [ ] Confirm the dashboard opens and all three demo pages load.
- [ ] Run the analysis action and verify the returned findings.
- [ ] If demonstrating Kubernetes, start Minikube/Docker Desktop, configure the agent token and run a read-only snapshot.
- [ ] Do not describe snapshot values or synthetic examples as live cluster telemetry.
