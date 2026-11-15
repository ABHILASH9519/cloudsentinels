[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$composeFile = Join-Path $PSScriptRoot "docker-compose.yml"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker Desktop is required." }
docker info --format "{{.ServerVersion}}" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop engine is not ready." }
docker volume inspect n8n_data 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { docker volume create n8n_data | Out-Null }
docker pull n8nio/n8n:2.16.1
if ($LASTEXITCODE -ne 0) { throw "Could not pull the pinned n8n image." }
$existing = docker inspect n8n 2>$null | ConvertFrom-Json
if ($existing) {
  $labels = $existing[0].Config.Labels
  $composeProject = $labels.'com.docker.compose.project'
  if ($composeProject -ne "cloudsentinels-automation") {
    $mount = @($existing[0].Mounts | Where-Object { $_.Destination -eq "/home/node/.n8n" -and $_.Name -eq "n8n_data" })
    if (-not $mount) { throw "Existing n8n container does not use the expected persistent n8n_data volume; refusing replacement." }
    $backupDir = Join-Path $env:LOCALAPPDATA ("CloudSentinels\backups\n8n-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    docker stop n8n | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not stop existing n8n container for a consistent backup." }
    docker cp n8n:/home/node/.n8n $backupDir
    if ($LASTEXITCODE -ne 0) { docker start n8n | Out-Null; throw "n8n data backup failed; existing container was restarted." }
    docker rm n8n | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not replace the n8n container; persistent volume and backup remain intact." }
    Write-Output "N8N_DATA_BACKUP=$backupDir"
  }
}
docker compose -p cloudsentinels-automation -f $composeFile up -d
if ($LASTEXITCODE -ne 0) { throw "Could not start the pinned n8n Compose service." }
$healthy = $false
for ($i = 0; $i -lt 60; $i++) {
  try { $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:5678/healthz" -TimeoutSec 2; if ($r.StatusCode -eq 200) { $healthy = $true; break } } catch {}
  Start-Sleep -Seconds 1
}
if (-not $healthy) { docker logs n8n --tail 50; throw "n8n did not become healthy. Persistent volume n8n_data was retained." }
Write-Output "N8N_READY image=n8nio/n8n:2.16.1 url=http://localhost:5678 volume=n8n_data"