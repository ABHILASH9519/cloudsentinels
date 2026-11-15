[CmdletBinding()]
param([switch]$SkipRestart)

$ErrorActionPreference = "Stop"
$workflowId = "cloudsentinelsUnified"
$container = "n8n"
$workflowFile = Join-Path $PSScriptRoot "n8n-cloudsentinels-unified.json"
$buildScript = Join-Path $PSScriptRoot "build-unified-workflow.ps1"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker CLI is required." }
docker inspect $container | Out-Null
if ($LASTEXITCODE -ne 0) { throw "The local n8n container is not available." }

& $buildScript
if ($LASTEXITCODE -ne 0) { throw "Workflow build failed." }

docker exec $container n8n unpublish:workflow --id=$workflowId 2>$null | Out-Null
docker cp $workflowFile ($container + ":/tmp/cloudsentinels-unified.json")
if ($LASTEXITCODE -ne 0) { throw "Could not copy workflow JSON into the n8n container." }

docker exec $container n8n import:workflow --input=/tmp/cloudsentinels-unified.json
if ($LASTEXITCODE -ne 0) { throw "n8n workflow import failed." }
docker exec $container n8n publish:workflow --id=$workflowId
if ($LASTEXITCODE -ne 0) { throw "n8n workflow publish failed." }

if (-not $SkipRestart) {
  docker restart $container | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "n8n container restart failed." }
  $healthy = $false
  for ($i = 0; $i -lt 20; $i++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:5678/healthz" -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $healthy = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
  }
  if (-not $healthy) { throw "n8n did not become healthy after restart." }
}

Write-Output "UNIFIED_WORKFLOW_PUBLISHED id=$workflowId"
Write-Output "WEBHOOK=http://127.0.0.1:5678/webhook/cloudsentinels/unified-events"
