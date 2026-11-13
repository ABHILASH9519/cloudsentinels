$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root ".local-demo-pids.json"
if (-not (Test-Path $pidFile)) {
  Write-Host "No local demo PID file found."
  exit 0
}
$tracked = Get-Content $pidFile -Raw | ConvertFrom-Json
foreach ($processId in @($tracked.apiPid, $tracked.uiPid)) {
  if ($processId) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
      Stop-Process -Id $processId -Force
      Write-Host "Stopped local demo process $processId."
    }
  }
}
Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
Write-Host "CloudSentinels local demo stopped."
