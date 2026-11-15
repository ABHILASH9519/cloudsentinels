[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root

function Import-EnvFile([string]$Path) {
  if (-not (Test-Path $Path)) { throw "Required environment file is missing: $Path" }
  foreach ($line in Get-Content $Path) {
    if ($line -match '^\s*([^#=][^=]*)=(.*)$') {
      $key = $matches[1].Trim()
      $value = $matches[2].Trim().Trim('"').Trim("'")
      [Environment]::SetEnvironmentVariable($key, $value, "Process")
    }
  }
}

function Test-Http([string]$Url) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

Import-EnvFile (Join-Path $root ".env.local")
Import-EnvFile (Join-Path $root "src\frontend\.env.local")

if (-not (Test-Path $env:GOOGLE_APPLICATION_CREDENTIALS)) {
  throw "Firebase Admin credentials file is not available at the configured local path."
}
if (-not (Test-Path (Join-Path $root "src\frontend\node_modules\vite\bin\vite.js"))) {
  throw "Frontend dependencies are missing. Run pnpm install in src\frontend first."
}

$env:CLOUDSENTINELS_HTTP_ADDR = ":8085"
$env:CLOUDSENTINELS_EXECUTION_MODE = "online-server"
$env:CLOUDSENTINELS_ENV = "development"
$env:CLOUDSENTINELS_ALLOWED_ORIGINS = "http://localhost:5174,http://127.0.0.1:5174"
$env:VITE_CLOUDSENTINELS_API_URL = "http://127.0.0.1:8085"

if (-not (Test-Http "http://127.0.0.1:8085/readyz")) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort 8085 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) { throw "Port 8085 is occupied by a process that is not a ready CloudSentinels API." }
  Write-Host "Building the main-branch Go API..."
  & go build -trimpath -o (Join-Path $root ".local-review-api.exe") .\cmd\cloudsentinels
  if ($LASTEXITCODE -ne 0) { throw "Go API build failed." }
  $api = Start-Process -FilePath (Join-Path $root ".local-review-api.exe") -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root ".local-review-api.out.log") -RedirectStandardError (Join-Path $root ".local-review-api.err.log")
  Set-Content -Path (Join-Path $root ".local-review-api.pid") -Value $api.Id
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline -and -not (Test-Http "http://127.0.0.1:8085/readyz")) { Start-Sleep -Seconds 2 }
  if (-not (Test-Http "http://127.0.0.1:8085/readyz")) { throw "Go API did not become ready. Check .local-review-api.err.log." }
} else {
  Write-Host "Go API already ready on port 8085."
}

if (-not (Test-Http "http://127.0.0.1:5174/")) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort 5174 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) { throw "Port 5174 is occupied by a process that is not the review UI." }
  $vite = Join-Path $root "src\frontend\node_modules\vite\bin\vite.js"
  $node = (Get-Command node.exe).Source
  $ui = Start-Process -FilePath $node -ArgumentList @($vite, "--host", "127.0.0.1", "--port", "5174", "--strictPort") -WorkingDirectory (Join-Path $root "src\frontend") -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root ".local-review-ui.out.log") -RedirectStandardError (Join-Path $root ".local-review-ui.err.log")
  Set-Content -Path (Join-Path $root ".local-review-ui.pid") -Value $ui.Id
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline -and -not (Test-Http "http://127.0.0.1:5174/")) { Start-Sleep -Seconds 2 }
  if (-not (Test-Http "http://127.0.0.1:5174/")) { throw "Frontend did not become ready. Check .local-review-ui.err.log." }
} else {
  Write-Host "Review UI already ready on port 5174."
}

foreach ($item in @(
  @{ ClusterId = "docker-desktop-kubernetes"; Context = "docker-desktop"; Environment = "local-docker-desktop" },
  @{ ClusterId = "cloudsentinels-local"; Context = "cloudsentinels-local"; Environment = "local-minikube" }
)) {
  $env:KUBECONFIG = $null
  & kubectl --context $item.Context get nodes
  if ($LASTEXITCODE -ne 0) { throw "Kubernetes context is unavailable: $($item.Context)" }
  & .\deploy\agent\local\start-agent.ps1 -ClusterId $item.ClusterId -Context $item.Context -ApiUrl "http://127.0.0.1:8085" -Environment $item.Environment -AllowedNamespaces "cloudsentinels-benchmark" -EnableApprovedRemediation
  if ($LASTEXITCODE -ne 0) { throw "Could not start the approval-gated local agent for $($item.Context)" }
  & kubectl --context $item.Context top nodes
  if ($LASTEXITCODE -ne 0) { throw "Metrics Server is unavailable for $($item.Context)" }
}

Write-Host ""
Write-Host "CloudSentinels local review stack is ready."
Write-Host "UI:  http://127.0.0.1:5174"
Write-Host "API: http://127.0.0.1:8085"
Write-Host "n8n: http://127.0.0.1:5678"
Write-Host "AWS online services were not started or modified."
