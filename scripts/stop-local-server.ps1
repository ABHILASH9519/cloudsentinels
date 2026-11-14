$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root ".local-server-pids.json"
if (Test-Path $pidFile) {
  $pids = Get-Content $pidFile -Raw | ConvertFrom-Json
  foreach ($id in @($pids.apiPid, $pids.uiPid)) {
    if ($id) { Stop-Process -Id ([int]$id) -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}
$agentPidFile = Join-Path $root ".local-cloudsentinels-agent.pid"
if (Test-Path $agentPidFile) {
  $agentPid = 0
  [void][int]::TryParse((Get-Content $agentPidFile -Raw).Trim(), [ref]$agentPid)
  if ($agentPid -gt 0) { Stop-Process -Id $agentPid -Force -ErrorAction SilentlyContinue }
  Remove-Item $agentPidFile -Force -ErrorAction SilentlyContinue
}
Write-Host "CloudSentinels API, frontend and local agent stopped. The Minikube cluster remains running."
