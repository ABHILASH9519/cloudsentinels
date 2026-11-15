[CmdletBinding()]
param()
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$composeFile = Join-Path $PSScriptRoot "docker-compose.yml"
docker compose -p cloudsentinels-automation -f $composeFile stop
if ($LASTEXITCODE -ne 0) { throw "Could not stop the local n8n service." }
Write-Output "N8N_STOPPED; persistent volume n8n_data was retained."