[CmdletBinding()]
param()
$stateDir = Join-Path $env:LOCALAPPDATA "CloudSentinels\aws"
$pidFile = Join-Path $stateDir "n8n-sqs-poller.pid"
if (-not (Test-Path $pidFile)) { Write-Output "AWS_N8N_POLLER_NOT_RUNNING"; exit 0 }
$pidValue = 0
[void][int]::TryParse((Get-Content -Raw $pidFile).Trim(), [ref]$pidValue)
if ($pidValue -gt 0 -and (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) {
  Stop-Process -Id $pidValue -Force
  Write-Output "AWS_N8N_POLLER_STOPPED pid=$pidValue"
} else { Write-Output "AWS_N8N_POLLER_NOT_RUNNING" }
Remove-Item $pidFile -Force -ErrorAction SilentlyContinue