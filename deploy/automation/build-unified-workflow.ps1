$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "build-unified-workflow.js"
node $script
if ($LASTEXITCODE -ne 0) { throw "Unified n8n workflow build failed." }
