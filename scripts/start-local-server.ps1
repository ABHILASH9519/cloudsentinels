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
function Write-EnvFile([string]$path, [hashtable]$values) {
  $values.GetEnumerator() | Sort-Object Key | ForEach-Object { "$($_.Key)=$($_.Value)" } | Set-Content -Encoding ascii $path
}

$apiEnvPath = Join-Path $root ".env.local"
$uiEnvPath = Join-Path $frontend ".env.local"
$apiEnv = Read-EnvFile $apiEnvPath
$uiEnv = Read-EnvFile $uiEnvPath

# Use the deployed Cognito user pool and AWS API; never create a mock local identity.
$region = "ap-south-1"
$userPoolId = "ap-south-1_Bf5KKrLB4"
$clientId = "46s1e0os9rjnqd75ijiagoqb53"
$cognitoDomain = "https://cloudsentinels-abhilash.auth.ap-south-1.amazoncognito.com"
$awsApiUrl = "https://kp32d8ahi6.execute-api.ap-south-1.amazonaws.com/v1"
$issuer = "https://cognito-idp.ap-south-1.amazonaws.com/$userPoolId"

$agentToken = $apiEnv["CLOUDSENTINELS_AGENT_TOKEN"]
if (-not $agentToken -or $agentToken.Length -lt 32) { $agentToken = New-SecretToken }
$apiEnv["CLOUDSENTINELS_HTTP_ADDR"] = ":8082"
$apiEnv["CLOUDSENTINELS_EXECUTION_MODE"] = "online-server"
$apiEnv["CLOUDSENTINELS_ENV"] = "development"
$apiEnv["CLOUDSENTINELS_ALLOWED_ORIGINS"] = "http://localhost:5173,http://127.0.0.1:5173"
$apiEnv["AIRTABLE_SNAPSHOT_PATH"] = "deploy/eks/airtable-inventory.snapshot.json"
$apiEnv["CLOUDSENTINELS_AGENT_TOKEN"] = $agentToken
$apiEnv["CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS"] = "false"
$apiEnv["COGNITO_ISSUER_URL"] = $issuer
$apiEnv["COGNITO_APP_CLIENT_ID"] = $clientId
$apiEnv.Remove("CLOUDSENTINELS_LOCAL_AUTH_TOKEN")
$apiEnv.Remove("CLOUDSENTINELS_ALLOW_LOCAL_AUTH_IN_PROD")
Write-EnvFile $apiEnvPath $apiEnv

$uiEnv["VITE_AWS_REGION"] = $region
$uiEnv["VITE_COGNITO_USER_POOL_ID"] = $userPoolId
$uiEnv["VITE_COGNITO_CLIENT_ID"] = $clientId
$uiEnv["VITE_COGNITO_DOMAIN"] = $cognitoDomain
$uiEnv["VITE_AWS_API_URL"] = $awsApiUrl
$uiEnv["VITE_CLOUDSENTINELS_API_URL"] = "http://127.0.0.1:8082"
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
    $health = Invoke-RestMethod "http://127.0.0.1:8082/healthz" -TimeoutSec 2
    $page = Invoke-WebRequest "http://127.0.0.1:5173/" -UseBasicParsing -TimeoutSec 2
    if ($health.status -eq "ok" -and $page.StatusCode -eq 200) { $ready = $true; break }
  } catch { Start-Sleep -Seconds 1 }
}
if (-not $ready) {
  Write-Error "Local operational services did not become ready. Check .local-server-api.err.log and .local-server-ui.err.log."
  exit 1
}
Write-Host "CloudSentinels local services are running."
Write-Host "Dashboard: http://localhost:5173/#/clusters"
Write-Host "AWS API health: $awsApiUrl/health"
Write-Host "Go API health: http://127.0.0.1:8082/healthz"
Write-Host "Authentication: Amazon Cognito (sign-in or self-register and verify email)."
Write-Host "Kubernetes: Docker-backed Minikube profile cloudsentinels-local."

& powershell -ExecutionPolicy Bypass -File ".\scripts\kubernetes\start-local-cluster.ps1"
if ($LASTEXITCODE -ne 0) { throw "Local Kubernetes setup or agent connection failed." }
Start-Process "http://localhost:5173/#/clusters"
