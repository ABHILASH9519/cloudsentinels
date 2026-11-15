[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ClusterId)
$stateDir = Join-Path $env:LOCALAPPDATA "CloudSentinels\agents"
$pidFile = Join-Path $stateDir ($ClusterId + ".pid")
if (-not (Test-Path $pidFile)) { Write-Output "AGENT_NOT_RUNNING cluster=$ClusterId"; exit 0 }
$agentPid = 0
[void][int]::TryParse((Get-Content -Raw $pidFile).Trim(), [ref]$agentPid)
if ($agentPid -gt 0 -and (Get-Process -Id $agentPid -ErrorAction SilentlyContinue)) {
  Stop-Process -Id $agentPid -Force
  Write-Output "AGENT_STOPPED cluster=$ClusterId pid=$agentPid"
} else {
  Write-Output "AGENT_PROCESS_NOT_FOUND cluster=$ClusterId"
}
Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $stateDir ($ClusterId + ".kubeconfig")) -Force -ErrorAction SilentlyContinue
