$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root "src\frontend"
Set-Location $root

function New-SecretToken {
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 32
  $rng.GetBytes($bytes)
  $rng.Dispose()
  return [BitConverter]::ToString($bytes).Replace("-", "")
}

function Read-EnvFile([string]$path) {
  $values = @{}
  if (Test-Path $path) {
    Get-Content $path | ForEach-Object {
      if ($_ -match '^([^#=][^=]*)=(.*)$') { $values[$matches[1].Trim()] = $matches[2].Trim() }
    }
  }
  return $values
}

$apiEnvPath = Join-Path $root ".env.local"
$uiEnvPath = Join-Path $frontend ".env.local"
$apiEnv = Read-EnvFile $apiEnvPath
$uiEnv = Read-EnvFile $uiEnvPath
$localToken = $apiEnv["CLOUDSENTINELS_LOCAL_AUTH_TOKEN"]
if (-not $localToken -or $localToken.Length -lt 32) { $localToken = New-SecretToken }
$agentToken = $apiEnv["CLOUDSENTINELS_AGENT_TOKEN"]
if (-not $agentToken -or $agentToken.Length -lt 32) { $agentToken = New-SecretToken }

$apiEnv["CLOUDSENTINELS_HTTP_ADDR"] = ":8082"
$apiEnv["CLOUDSENTINELS_EXECUTION_MODE"] = "online-server"
$apiEnv["CLOUDSENTINELS_ENV"] = "development"
$apiEnv["CLOUDSENTINELS_LOCAL_AUTH_TOKEN"] = $localToken
$apiEnv["CLOUDSENTINELS_ALLOWED_ORIGINS"] = "http://localhost:5173,http://127.0.0.1:5173"
$apiEnv["AIRTABLE_SNAPSHOT_PATH"] = "deploy/eks/airtable-inventory.snapshot.json"
$apiEnv["CLOUDSENTINELS_AGENT_TOKEN"] = $agentToken
$apiEnv["CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS"] = "false"
$apiEnv.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" } | Set-Content -Encoding ascii $apiEnvPath

$uiEnv["VITE_CLOUDSENTINELS_API_URL"] = "http://127.0.0.1:8082"
$uiEnv["VITE_CLOUDSENTINELS_LOCAL_DEMO"] = "true"
$uiEnv["VITE_CLOUDSENTINELS_LOCAL_TOKEN"] = $localToken
$uiEnv.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" } | Set-Content -Encoding ascii $uiEnvPath

$env:CLOUDSENTINELS_HTTP_ADDR = $apiEnv["CLOUDSENTINELS_HTTP_ADDR"]
$env:CLOUDSENTINELS_EXECUTION_MODE = $apiEnv["CLOUDSENTINELS_EXECUTION_MODE"]
$env:CLOUDSENTINELS_ENV = $apiEnv["CLOUDSENTINELS_ENV"]
$env:CLOUDSENTINELS_LOCAL_AUTH_TOKEN = $localToken
$env:CLOUDSENTINELS_ALLOWED_ORIGINS = $apiEnv["CLOUDSENTINELS_ALLOWED_ORIGINS"]
$env:AIRTABLE_SNAPSHOT_PATH = $apiEnv["AIRTABLE_SNAPSHOT_PATH"]
$env:CLOUDSENTINELS_AGENT_TOKEN = $agentToken
$env:CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS = "false"

foreach ($port in @(8082, 5173)) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  if ($listener) { throw "Port $port is already in use. Run scripts/stop-local-demo.ps1 or stop the existing service first." }
}

$go = (Get-Command go.exe -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$viteEntry = Join-Path $frontend "node_modules\vite\bin\vite.js"
if (-not (Test-Path $viteEntry)) { throw "Frontend dependencies are missing. Run pnpm install from the repository root first." }

$apiOut = Join-Path $root ".local-demo-api.out.log"
$apiErr = Join-Path $root ".local-demo-api.err.log"
$uiOut = Join-Path $root ".local-demo-ui.out.log"
$uiErr = Join-Path $root ".local-demo-ui.err.log"
$apiExe = Join-Path $root ".local-demo-cloudsentinels.exe"
& $go build -trimpath -o $apiExe ./cmd/cloudsentinels
if ($LASTEXITCODE -ne 0) { throw "Go API build failed; no services were started." }
$apiProcess = Start-Process -FilePath $apiExe -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr
$uiProcess = Start-Process -FilePath $node -ArgumentList @($viteEntry, "--host", "127.0.0.1", "--port", "5173", "--strictPort") -WorkingDirectory $frontend -PassThru -WindowStyle Hidden -RedirectStandardOutput $uiOut -RedirectStandardError $uiErr

@{ apiPid = $apiProcess.Id; uiPid = $uiProcess.Id } | ConvertTo-Json | Set-Content -Encoding ascii (Join-Path $root ".local-demo-pids.json")

$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:8082/healthz" -TimeoutSec 2
    $page = Invoke-WebRequest "http://127.0.0.1:5173/" -UseBasicParsing -TimeoutSec 2
    if ($health.status -eq "ok" -and $page.StatusCode -eq 200) { $ready = $true; break }
  } catch { Start-Sleep -Seconds 1 }
}
if (-not $ready) {
  Write-Error "Local demo did not become ready. Check .local-demo-api.err.log and .local-demo-ui.err.log."
  exit 1
}

Write-Host "CloudSentinels local demo is ready." -ForegroundColor Green
Write-Host "Dashboard: http://localhost:5173/#/clusters"
Write-Host "Monitoring: http://localhost:5173/#/monitoring"
Write-Host "AI Insights: http://localhost:5173/#/ai-insights"
Write-Host "API health: http://127.0.0.1:8082/healthz"
Write-Host "Inventory source: sanitized Airtable snapshot (not live Airtable sync)."
Write-Host "Kubernetes agent: offline until a real local cluster is started and the agent is connected."
Start-Process "http://localhost:5173/#/clusters"
