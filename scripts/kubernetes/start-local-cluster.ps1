[CmdletBinding()]
param(
    [string]$Profile = "cloudsentinels-local",
    [string]$ApiUrl = "http://127.0.0.1:8082",
    [string]$AgentClusterId = "local-docker-k8s",
    [switch]$SkipAgent
)
$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot
function Invoke-Native {
    param([string]$File, [string[]]$Arguments)
    $output = & $File @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    if ($output) { $output | ForEach-Object { Write-Host $_ } }
    if ($exitCode -ne 0) { throw "$File failed with exit code $exitCode" }
}
foreach ($tool in @("docker", "minikube", "kubectl", "go")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is required." }
}
Invoke-Native "docker" @("info", "--format", "{{.ServerVersion}}") | Out-Null
$existingNodes = $null
$kubectlExitCode = 1
try {
    $existingNodes = & kubectl --context $Profile get nodes --no-headers 2>$null
    $kubectlExitCode = $LASTEXITCODE
} catch {
    $kubectlExitCode = 1
}
if ($kubectlExitCode -ne 0 -or -not $existingNodes) {
    Invoke-Native "minikube" @("start", "--driver=docker", "--cpus=2", "--memory=4096", "--profile=$Profile")
}
Invoke-Native "kubectl" @("--context", $Profile, "wait", "--for=condition=Ready", "nodes", "--all", "--timeout=180s")
Invoke-Native "kubectl" @("--context", $Profile, "apply", "-f", "deploy/kubernetes/local-inventory-service.yaml")
$yaml = & kubectl --context $Profile create configmap cloudsentinels-airtable-inventory -n cloudsentinels-system --from-file=inventory.json=deploy/eks/airtable-inventory.snapshot.json --dry-run=client -o yaml
if ($LASTEXITCODE -ne 0) { throw "Could not generate the Airtable inventory ConfigMap." }
$yaml | kubectl --context $Profile apply -f -
if ($LASTEXITCODE -ne 0) { throw "Failed to apply Airtable inventory ConfigMap." }
Invoke-Native "kubectl" @("--context", $Profile, "rollout", "status", "deployment/airtable-inventory", "-n", "cloudsentinels-system", "--timeout=180s")
$inventory = & kubectl --context $Profile get configmap cloudsentinels-airtable-inventory -n cloudsentinels-system -o jsonpath="{.data.inventory\.json}"
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($inventory)) { throw "Airtable inventory ConfigMap is missing or empty." }
$parsed = $inventory | ConvertFrom-Json
if ($parsed.clusters.recordCount -ne 20) { throw "Expected 20 Airtable cluster records; found $($parsed.clusters.recordCount)." }
Write-Host "Local Kubernetes is Ready: $Profile"
Write-Host "Airtable inventory mounted in-cluster: $($parsed.clusters.recordCount) cluster records"
Write-Host "Inventory service: http://airtable-inventory.cloudsentinels-system.svc.cluster.local/inventory/inventory.json"
if (-not $SkipAgent) {
    $envFile = Join-Path $repoRoot ".env.local"
    if (-not (Test-Path $envFile)) { throw ".env.local is required to authenticate the local agent." }
    $settings = @{}
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$' -and -not $line.TrimStart().StartsWith("#")) {
            $settings[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
        }
    }
    $agentToken = $settings["CLOUDSENTINELS_AGENT_TOKEN"]
    if ([string]::IsNullOrWhiteSpace($agentToken) -or $agentToken.Length -lt 32) { throw "A valid 32+ character CLOUDSENTINELS_AGENT_TOKEN is required in .env.local." }
    try { Invoke-RestMethod -Uri ($ApiUrl.TrimEnd("/") + "/healthz") -TimeoutSec 5 | Out-Null }
    catch { throw "CloudSentinels API is not reachable at $ApiUrl. Start the Go API first." }
    $agentBinary = Join-Path $repoRoot ".local-cloudsentinels-agent.exe"
    Invoke-Native "go" @("build", "-o", $agentBinary, "./cmd/cloudsentinels-agent")
    $existingPidFile = Join-Path $repoRoot ".local-cloudsentinels-agent.pid"
    if (Test-Path $existingPidFile) {
        $existingPid = 0
        [void][int]::TryParse((Get-Content $existingPidFile -Raw).Trim(), [ref]$existingPid)
        if ($existingPid -gt 0 -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
            Write-Host "CloudSentinels agent already running (PID $existingPid)."
            return
        }
    }
    $env:CLOUDSENTINELS_API_URL = $ApiUrl.TrimEnd("/")
    $env:CLOUDSENTINELS_AGENT_TOKEN = $agentToken
    $env:CLOUDSENTINELS_AGENT_CLUSTER_ID = $AgentClusterId
    $env:CLOUDSENTINELS_AGENT_CONTEXT = $Profile
    $env:CLOUDSENTINELS_AGENT_INTERVAL = "15s"
    $env:CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS = "false"
    $process = Start-Process -FilePath $agentBinary -WorkingDirectory $repoRoot -PassThru -WindowStyle Hidden
    Set-Content -Path $existingPidFile -Value $process.Id -NoNewline
    Write-Host "CloudSentinels read-only Kubernetes agent started (PID $($process.Id))."
    Write-Host "Mutation execution remains disabled."
}
