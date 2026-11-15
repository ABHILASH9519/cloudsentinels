[CmdletBinding()]
param(
  [string[]]$Contexts = @("docker-desktop", "cloudsentinels-local"),
  [switch]$SkipMetricsServer
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$manifest = Join-Path $PSScriptRoot "review-benchmark.yaml"
$metricsPatch = Join-Path $PSScriptRoot "metrics-server-review-patch.json"
Set-Location $root

$available = @(& kubectl config get-contexts -o name)
if ($LASTEXITCODE -ne 0) { throw "Could not read Kubernetes contexts." }
foreach ($context in $Contexts) {
  if ($available -notcontains $context) { throw "Kubernetes context is missing: $context" }
  & kubectl --context $context wait --for=condition=Ready nodes --all --timeout=60s
  if ($LASTEXITCODE -ne 0) { throw "Nodes are not Ready in $context" }
}

if (-not $SkipMetricsServer -and $Contexts -contains "docker-desktop") {
  $metricsArgs = @(& kubectl --context docker-desktop -n kube-system get deployment metrics-server -o jsonpath='{.spec.template.spec.containers[0].args}' 2>$null)
  if ($LASTEXITCODE -ne 0) {
    & kubectl --context docker-desktop apply -f "https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.8.0/components.yaml"
    if ($LASTEXITCODE -ne 0) { throw "Could not install Metrics Server on Docker Desktop." }
  }
  if (($metricsArgs -join " ") -notmatch "--kubelet-insecure-tls") {
    & kubectl --context docker-desktop -n kube-system patch deployment metrics-server --type=strategic --patch-file $metricsPatch
    if ($LASTEXITCODE -ne 0) { throw "Could not apply the local Docker Desktop Metrics Server compatibility setting." }
  }
  & kubectl --context docker-desktop -n kube-system rollout status deployment/metrics-server --timeout=180s
  if ($LASTEXITCODE -ne 0) { throw "Docker Desktop Metrics Server is not Ready." }
}

foreach ($context in $Contexts) {
  Write-Host "=== $($context): apply matched review workload ==="
  & kubectl --context $context apply -f $manifest
  if ($LASTEXITCODE -ne 0) { throw "Workload apply failed on $context" }
  & kubectl --context $context -n cloudsentinels-benchmark rollout status deployment/benchmark-api --timeout=180s
  if ($LASTEXITCODE -ne 0) { throw "Benchmark API rollout failed on $context" }
  & kubectl --context $context -n cloudsentinels-benchmark rollout status deployment/benchmark-worker --timeout=180s
  if ($LASTEXITCODE -ne 0) { throw "Benchmark worker rollout failed on $context" }

  Write-Host "=== $($context): service connectivity ==="
  & kubectl --context $context -n cloudsentinels-benchmark run service-check --rm -i --restart=Never --image=busybox:1.36 -- wget -qO- --timeout=5 http://benchmark-api.cloudsentinels-benchmark.svc.cluster.local/
  if ($LASTEXITCODE -ne 0) { throw "Benchmark service check failed on $context" }

  Write-Host "=== $($context): controller self-healing ==="
  $pod = & kubectl --context $context -n cloudsentinels-benchmark get pods -l app.kubernetes.io/name=benchmark-api -o jsonpath='{.items[0].metadata.name}'
  if ($LASTEXITCODE -ne 0 -or -not $pod) { throw "Could not select a benchmark API pod on $context" }
  & kubectl --context $context -n cloudsentinels-benchmark delete pod $pod --wait=true
  if ($LASTEXITCODE -ne 0) { throw "Could not delete the selected test pod on $context" }
  & kubectl --context $context -n cloudsentinels-benchmark rollout status deployment/benchmark-api --timeout=90s
  if ($LASTEXITCODE -ne 0) { throw "Deployment did not self-heal on $context" }
  $ready = & kubectl --context $context -n cloudsentinels-benchmark get deployment benchmark-api -o jsonpath='{.status.readyReplicas}/{.spec.replicas}'
  if ($ready -ne "3/3") { throw "Expected 3/3 ready API replicas on $context; got $ready" }

  Write-Host "=== $($context): final workload and resource parity ==="
  & kubectl --context $context -n cloudsentinels-benchmark get deployments,pods,services,resourcequota -o wide
  & kubectl --context $context top nodes
  & kubectl --context $context -n cloudsentinels-benchmark top pods
  if ($LASTEXITCODE -ne 0) { throw "Metrics API unavailable on $context" }
}

Write-Host "PASS: matched workload, service connectivity, pod self-healing and metrics checks passed on all requested contexts."
