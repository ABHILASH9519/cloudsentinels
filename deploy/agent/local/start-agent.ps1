[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ClusterId,
  [Parameter(Mandatory=$true)][string]$Context,
  [string]$ApiUrl = "http://127.0.0.1:8082",
  [string]$Environment = "local",
  [string]$AllowedNamespaces = "cloudsentinels-system",
  [switch]$EnableApprovedRemediation
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$envFile = Join-Path $root ".env.local"
if (-not (Test-Path $envFile)) { throw "Repository .env.local is missing." }

$agentToken = $null
foreach ($line in [System.IO.File]::ReadAllLines($envFile)) {
  if ($line -match '^\s*CLOUDSENTINELS_AGENT_TOKEN\s*=(.*)$') {
    $agentToken = $Matches[1].Trim()
    if (($agentToken.StartsWith('"') -and $agentToken.EndsWith('"')) -or ($agentToken.StartsWith("'") -and $agentToken.EndsWith("'"))) {
      $agentToken = $agentToken.Substring(1, $agentToken.Length - 2)
    }
    break
  }
}
if ([string]::IsNullOrWhiteSpace($agentToken) -or $agentToken.Length -lt 32) { throw "A valid CLOUDSENTINELS_AGENT_TOKEN is required in .env.local." }

$health = Invoke-RestMethod -Uri ($ApiUrl.TrimEnd("/") + "/healthz") -TimeoutSec 5
if ($health.status -ne "ok") { throw "CloudSentinels API is not healthy at $ApiUrl." }

$stateDir = Join-Path $env:LOCALAPPDATA "CloudSentinels\agents"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$kubeconfig = Join-Path $stateDir ($ClusterId + ".kubeconfig")
$pidFile = Join-Path $stateDir ($ClusterId + ".pid")
$logFile = Join-Path $stateDir ($ClusterId + ".log")
$errorFile = Join-Path $stateDir ($ClusterId + ".err")

if (Test-Path $pidFile) {
  $oldPid = 0
  [void][int]::TryParse((Get-Content -Raw $pidFile).Trim(), [ref]$oldPid)
  if ($oldPid -gt 0 -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $oldPid -Force
    Start-Sleep -Milliseconds 500
  }
}

$kubeJson = kubectl config view --raw --flatten --minify --context=$Context -o json
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($kubeJson)) { throw "Could not create a context-scoped kubeconfig for $Context." }
[System.IO.File]::WriteAllText($kubeconfig, $kubeJson, (New-Object System.Text.UTF8Encoding($false)))
$principal = "$env:USERDOMAIN\$env:USERNAME"
& icacls.exe $kubeconfig /inheritance:r /grant:r "$principal`:(F)" "*S-1-5-18`:(F)" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not restrict permissions on the context-scoped kubeconfig." }
kubectl --kubeconfig $kubeconfig config use-context $Context | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Context $Context is not present in the generated kubeconfig." }

$env:KUBECONFIG = $kubeconfig
$env:CLOUDSENTINELS_API_URL = $ApiUrl.TrimEnd("/")
$env:CLOUDSENTINELS_AGENT_TOKEN = $agentToken
$env:CLOUDSENTINELS_AGENT_CLUSTER_ID = $ClusterId
$env:CLOUDSENTINELS_AGENT_CONTEXT = $Context
$env:CLOUDSENTINELS_AGENT_SOURCE_TYPE = "kubernetes-agent"
$env:CLOUDSENTINELS_AGENT_ENVIRONMENT = $Environment
$env:CLOUDSENTINELS_AGENT_INTERVAL = "30s"
$env:CLOUDSENTINELS_AGENT_ALLOWED_NAMESPACES = $AllowedNamespaces
$mutationFlag = "false"
if ($EnableApprovedRemediation) { $mutationFlag = "true" }
$env:CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS = $mutationFlag

$agentExe = Join-Path $stateDir "cloudsentinels-agent.exe"
Push-Location $root
try {
  go build -o $agentExe .\cmd\cloudsentinels-agent
  if ($LASTEXITCODE -ne 0) { throw "CloudSentinels Kubernetes agent build failed." }
} finally {
  Pop-Location
}

$process = Start-Process -FilePath $agentExe -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $errorFile -PassThru
[System.IO.File]::WriteAllText($pidFile, [string]$process.Id)
Start-Sleep -Seconds 3
if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
  Get-Content $errorFile -Tail 20 -ErrorAction SilentlyContinue
  throw "CloudSentinels agent exited during startup. See $errorFile."
}

Write-Output "AGENT_STARTED cluster=$ClusterId context=$Context pid=$($process.Id)"
Write-Output "API=$ApiUrl interval=30s mutations=$mutationFlag allowedNamespaces=$AllowedNamespaces"
Write-Output "KUBECONFIG=$kubeconfig"
Write-Output "LOG=$logFile"
