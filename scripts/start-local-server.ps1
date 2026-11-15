[CmdletBinding()]
param([switch]$EnableApprovedRemediation)

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
      if ($_ -match '^([^#=][^=]*)=(.*)$') { $values[$matches[1].Trim()] = $matches[2].Trim().Trim('"').Trim("'") }
    }
  }
  return $values
}
function Write-EnvFile([string]$path, [hashtable]$values) {
  $values.GetEnumerator() | Sort-Object Key | ForEach-Object { "$($_.Key)=$($_.Value)" } | Set-Content -Encoding ascii $path
}

$apiEnvPath = Join-Path $root ".env.local"
$uiEnvPath = Join-Path $frontend ".env.local"
$apiEnv = Read-EnvFile $apiEnvPath
$uiEnv = Read-EnvFile $uiEnvPath

# The browser and Go API share Firebase Authentication. Fail closed rather than
# starting a dashboard whose login is configured for a different identity provider.
$requiredClientKeys = @("VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID")
foreach ($key in $requiredClientKeys) {
  if ([string]::IsNullOrWhiteSpace([string]$uiEnv[$key])) { throw "Missing $key in src/frontend/.env.local. Copy the public Firebase Web App values from docs/architecture/firebase-frontend-setup.md." }
}
$firebaseProject = [string]$apiEnv["FIREBASE_PROJECT_ID"]
if ([string]::IsNullOrWhiteSpace($firebaseProject)) { $firebaseProject = [string]$uiEnv["VITE_FIREBASE_PROJECT_ID"] }
if ([string]::IsNullOrWhiteSpace($firebaseProject) -or $firebaseProject -ne [string]$uiEnv["VITE_FIREBASE_PROJECT_ID"]) { throw "FIREBASE_PROJECT_ID must match VITE_FIREBASE_PROJECT_ID in the Firebase Web App configuration." }
$adminJson = [string]$apiEnv["FIREBASE_SERVICE_ACCOUNT_JSON"]
$adminFile = [string]$apiEnv["GOOGLE_APPLICATION_CREDENTIALS"]
$adcFile = Join-Path $env:APPDATA "gcloud\application_default_credentials.json"
if ($adminFile -and -not (Test-Path $adminFile)) { throw "GOOGLE_APPLICATION_CREDENTIALS points to a file that does not exist." }
if (-not $adminJson -and -not $adminFile -and -not (Test-Path $adcFile)) { throw "Configure Firebase Admin credentials using GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_SERVICE_ACCOUNT_JSON, or Google Application Default Credentials before starting the authenticated API." }
if ($adminJson) {
  try { $adminCredential = $adminJson | ConvertFrom-Json -ErrorAction Stop } catch { throw "FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON." }
  if ($adminCredential.project_id -and $adminCredential.project_id -ne $firebaseProject) { throw "Firebase Admin service-account project_id does not match FIREBASE_PROJECT_ID." }
}
if ($adminFile) {
  try { $adminCredential = Get-Content -Raw $adminFile | ConvertFrom-Json -ErrorAction Stop } catch { throw "GOOGLE_APPLICATION_CREDENTIALS must point to a valid Firebase Admin service-account JSON file." }
  if ($adminCredential.project_id -and $adminCredential.project_id -ne $firebaseProject) { throw "Firebase Admin service-account project_id does not match FIREBASE_PROJECT_ID." }
}
$n8nUrl = [string]$apiEnv["N8N_WEBHOOK_URL"]
$n8nSecret = [string]$apiEnv["N8N_SIGNING_SECRET"]
if ($n8nUrl -ne "http://127.0.0.1:5678/webhook/cloudsentinels/unified-events" -or $n8nSecret.Length -lt 32) { throw "Configure the local unified n8n webhook URL and a separate N8N_SIGNING_SECRET of at least 32 characters in the ignored root .env.local." }

$agentToken = $apiEnv["CLOUDSENTINELS_AGENT_TOKEN"]
if (-not $agentToken -or $agentToken.Length -lt 32) { $agentToken = New-SecretToken }
$apiEnv["FIREBASE_PROJECT_ID"] = $firebaseProject
$apiEnv["CLOUDSENTINELS_HTTP_ADDR"] = ":8082"
$apiEnv["CLOUDSENTINELS_EXECUTION_MODE"] = "online-server"
$apiEnv["CLOUDSENTINELS_ENV"] = "development"
$apiEnv["CLOUDSENTINELS_ALLOWED_ORIGINS"] = "http://localhost:5173,http://127.0.0.1:5173"
$apiEnv["AIRTABLE_SNAPSHOT_PATH"] = "deploy/eks/airtable-inventory.snapshot.json"
$apiEnv["CLOUDSENTINELS_AGENT_TOKEN"] = $agentToken
$apiEnv["CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS"] = if ($EnableApprovedRemediation) { "true" } else { "false" }
$apiEnv.Remove("COGNITO_ISSUER_URL")
$apiEnv.Remove("COGNITO_APP_CLIENT_ID")
$apiEnv.Remove("CLOUDSENTINELS_LOCAL_AUTH_TOKEN")
$apiEnv.Remove("CLOUDSENTINELS_ALLOW_LOCAL_AUTH_IN_PROD")
Write-EnvFile $apiEnvPath $apiEnv

$uiEnv["VITE_CLOUDSENTINELS_API_URL"] = "http://127.0.0.1:8082"
$uiEnv.Remove("VITE_COGNITO_USER_POOL_ID")
$uiEnv.Remove("VITE_COGNITO_CLIENT_ID")
$uiEnv.Remove("VITE_COGNITO_DOMAIN")
$uiEnv.Remove("VITE_AWS_API_URL")
$uiEnv.Remove("VITE_AWS_REGION")
$uiEnv.Remove("VITE_CLOUDSENTINELS_LOCAL_DEMO")
$uiEnv.Remove("VITE_CLOUDSENTINELS_LOCAL_TOKEN")
Write-EnvFile $uiEnvPath $uiEnv

foreach ($key in $apiEnv.Keys) { [Environment]::SetEnvironmentVariable($key, [string]$apiEnv[$key], "Process") }
foreach ($key in @("CLOUDSENTINELS_LOCAL_AUTH_TOKEN", "CLOUDSENTINELS_ALLOW_LOCAL_AUTH_IN_PROD")) {
  [Environment]::SetEnvironmentVariable($key, $null, "Process")
}

foreach ($port in @(8082, 5173)) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  if ($listener) { throw "Port $port is already in use. Run scripts/stop-local-server.ps1 before starting again." }
}
$go = (Get-Command go.exe -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$viteEntry = Join-Path $frontend "node_modules\vite\bin\vite.js"
if (-not (Test-Path $viteEntry)) { throw "Frontend dependencies are missing. Run pnpm install from the repository root first." }

$apiOut = Join-Path $root ".local-server-api.out.log"
$apiErr = Join-Path $root ".local-server-api.err.log"
$uiOut = Join-Path $root ".local-server-ui.out.log"
$uiErr = Join-Path $root ".local-server-ui.err.log"
$apiExe = Join-Path $root ".local-server-cloudsentinels.exe"
& $go build -trimpath -o $apiExe ./cmd/cloudsentinels
if ($LASTEXITCODE -ne 0) { throw "Go API build failed; no services were started." }
$apiProcess = Start-Process -FilePath $apiExe -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr
$uiProcess = Start-Process -FilePath $node -ArgumentList @($viteEntry, "--host", "127.0.0.1", "--port", "5173", "--strictPort") -WorkingDirectory $frontend -PassThru -WindowStyle Hidden -RedirectStandardOutput $uiOut -RedirectStandardError $uiErr
@{ apiPid = $apiProcess.Id; uiPid = $uiProcess.Id } | ConvertTo-Json | Set-Content -Encoding ascii (Join-Path $root ".local-server-pids.json")

$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:8082/readyz" -TimeoutSec 2
    $page = Invoke-WebRequest "http://127.0.0.1:5173/" -UseBasicParsing -TimeoutSec 2
    if ($health.status -eq "ready" -and $page.StatusCode -eq 200) { $ready = $true; break }
  } catch { Start-Sleep -Seconds 1 }
}
if (-not $ready) {
  Write-Error "Local operational services did not become ready. Check .local-server-api.err.log and .local-server-ui.err.log."
  exit 1
}
Write-Host "CloudSentinels local services are running."
Write-Host "Dashboard: http://localhost:5173/#/clusters"
Write-Host "Authentication: Firebase ID tokens verified by the Go API."
if ($EnableApprovedRemediation) { Write-Host "Approved remediation gate enabled; each mutation still requires signed operator approval." } else { Write-Host "Remediation mode: read-only (default)." }
Write-Host "Go API health: http://127.0.0.1:8082/healthz"

Write-Host "Kubernetes: Minikube and Docker Desktop agents will be attached to the shared Go API."

& powershell -ExecutionPolicy Bypass -File ".\scripts\kubernetes\start-local-cluster.ps1" -SkipAgent
if ($LASTEXITCODE -ne 0) { throw "Minikube setup failed." }
$attachArgs = @("-IncludeDockerDesktop")
if ($EnableApprovedRemediation) { $attachArgs += "-EnableApprovedRemediation" }
& powershell -ExecutionPolicy Bypass -File ".\deploy\agent\local\attach-local-clusters.ps1" @attachArgs
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop / Minikube agent attachment failed." }
Start-Process "http://localhost:5173/#/clusters"
