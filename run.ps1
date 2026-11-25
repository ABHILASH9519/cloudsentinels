[CmdletBinding()]
param(
    [ValidateSet("Help","Build","Init","Up","Down","Smoke","Agent")][string]$Action = "Help",
    [ValidateSet("docker-desktop","cloudsentinels-local")][string]$Context = "cloudsentinels-local",
    [switch]$Frontend
)
$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot
try {
    switch ($Action) {
        "Help" { Write-Output "run.ps1 -Action Build [-Frontend] | Init | Up | Down | Smoke | Agent [-Context context]" }
        "Build" {
            $buildArgs = @("scripts/build-artifacts.py")
            if ($Frontend) { $buildArgs += "--frontend" }
            & python @buildArgs
        }
        "Agent" { & python scripts/local.py agent $Context }
        default { & python scripts/local.py $Action.ToLowerInvariant() }
    }
    if ($Action -ne "Help" -and $LASTEXITCODE -ne 0) { throw "Requested action failed: $LASTEXITCODE" }
} finally {
    Pop-Location
}
