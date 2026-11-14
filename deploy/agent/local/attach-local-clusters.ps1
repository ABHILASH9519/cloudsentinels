[CmdletBinding()]
param(
  [string]$ApiUrl = "http://127.0.0.1:8082",
  [string]$AllowedNamespaces = "cloudsentinels-system",
  [switch]$IncludeDockerDesktop
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$startAgent = Join-Path $PSScriptRoot "start-agent.ps1"
$contexts = @(@{Context="cloudsentinels-local";ClusterId="cloudsentinels-local";Environment="local-minikube"})

if ($IncludeDockerDesktop) {
  $contexts += @{Context="docker-desktop";ClusterId="docker-desktop-kubernetes";Environment="local-docker-desktop"}
}

$available = @(& kubectl config get-contexts -o name)
if ($LASTEXITCODE -ne 0) { throw "Could not list kubeconfig contexts." }

foreach ($target in $contexts) {
  if ($available -notcontains $target.Context) {
    if ($target.Context -eq "docker-desktop") {
      Write-Warning "Docker Desktop Kubernetes context is not present. In Docker Desktop > Kubernetes, select Create cluster and wait for State=enabled, then rerun with -IncludeDockerDesktop."
      continue
    }
    throw "Required local Kubernetes context is missing: $($target.Context)"
  }

  & kubectl --context $target.Context wait --for=condition=Ready nodes --all --timeout=30s
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Context $($target.Context) exists but its nodes are not Ready; skipping this agent."
    continue
  }

  & $startAgent -ClusterId $target.ClusterId -Context $target.Context -ApiUrl $ApiUrl -Environment $target.Environment -AllowedNamespaces $AllowedNamespaces -EnableApprovedRemediation
  if ($LASTEXITCODE -ne 0) { throw "Agent startup failed for context $($target.Context)." }
}
