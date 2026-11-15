$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

docker version --format "{{.Server.Version}}" | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Docker Desktop Linux engine is not ready. Start Docker Desktop and retry."
}

$clusterName = "cloudsentinels-local"
$profileStatus = minikube status -p $clusterName --format='{{.Host}}' 2>$null
$null = kubectl --context $clusterName get nodes --request-timeout=5s 2>$null
$apiReady = ($LASTEXITCODE -eq 0)

if ($profileStatus.Trim() -ne "Running" -or -not $apiReady) {
    minikube start -p $clusterName --driver=docker --cpus=2 --memory=4096
    if ($LASTEXITCODE -ne 0) { throw "Minikube failed to start." }
} else {
    Write-Output "Minikube profile '$clusterName' is already running; leaving the cluster untouched."
}

kubectl --context cloudsentinels-local wait --for=condition=Ready nodes --all --timeout=180s
if ($LASTEXITCODE -ne 0) { throw "Kubernetes nodes did not become Ready." }

kubectl --context cloudsentinels-local get nodes -o wide
