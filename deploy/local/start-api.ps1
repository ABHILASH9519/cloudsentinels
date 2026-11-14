$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

$envFile = Join-Path $repoRoot ".env.local"
if (-not (Test-Path $envFile)) {
    throw "Create .env.local with private development credentials before starting the API."
}

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
}

if ([string]::IsNullOrWhiteSpace($env:CLOUDSENTINELS_LOCAL_AUTH_TOKEN)) {
    throw "CLOUDSENTINELS_LOCAL_AUTH_TOKEN is required for local development."
}
if ([string]::IsNullOrWhiteSpace($env:CLOUDSENTINELS_AGENT_TOKEN)) {
    throw "CLOUDSENTINELS_AGENT_TOKEN is required for the desktop agent."
}

$env:CLOUDSENTINELS_HTTP_ADDR = "127.0.0.1:18080"
$env:CLOUDSENTINELS_ENV = "development"
$env:CLOUDSENTINELS_EXECUTION_MODE = "online-server"

go run ./cmd/cloudsentinels
