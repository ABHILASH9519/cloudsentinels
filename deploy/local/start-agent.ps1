$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

$envFile = Join-Path $repoRoot ".env.local"
if (-not (Test-Path $envFile)) {
    throw "Create .env.local with the private agent token before starting the agent."
}

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
}

if ([string]::IsNullOrWhiteSpace($env:CLOUDSENTINELS_AGENT_TOKEN)) {
    throw "CLOUDSENTINELS_AGENT_TOKEN is required."
}

$agentExe = Join-Path $env:TEMP "cloudsentinels-agent.exe"
go build -trimpath -o $agentExe ./cmd/cloudsentinels-agent
if ($LASTEXITCODE -ne 0) { throw "Failed to build the desktop agent." }

$env:CLOUDSENTINELS_API_URL = "http://127.0.0.1:18080"
$env:CLOUDSENTINELS_AGENT_CLUSTER_ID = "cloudsentinels-local"
$env:CLOUDSENTINELS_AGENT_CONTEXT = "cloudsentinels-local"
$env:CLOUDSENTINELS_AGENT_SOURCE_TYPE = "local-kubernetes"
$env:CLOUDSENTINELS_AGENT_ENVIRONMENT = "local"
$env:CLOUDSENTINELS_AGENT_INTERVAL = "30s"
if ([string]::IsNullOrWhiteSpace($env:CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS)) {
    $env:CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS = "false"
}

& $agentExe
