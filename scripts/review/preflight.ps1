[CmdletBinding()]
param(
    [string]$AwsProfile = "My-Website",
    [string]$AwsRegion = "ap-south-1",
    [string]$AwsApiId = "kp32d8ahi6",
    [string]$AwsQueueUrl = "https://sqs.ap-south-1.amazonaws.com/115484989078/cloudsentinels-n8n-events"
)

$ErrorActionPreference = "Continue"
$script:Failures = 0
$script:Warnings = 0

function Write-Check([string]$Name, [string]$State, [string]$Detail) {
    $color = switch ($State) {
        "PASS" { "Green" }
        "WARN" { "Yellow" }
        default { "Red" }
    }
    Write-Host ("[{0}] {1} - {2}" -f $State, $Name, $Detail) -ForegroundColor $color
    if ($State -eq "FAIL") { $script:Failures++ }
    if ($State -eq "WARN") { $script:Warnings++ }
}

function Test-Http([string]$Name, [string]$Url, [int[]]$Expected = @(200)) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 8
        $code = [int]$response.StatusCode
        if ($Expected -contains $code) { Write-Check $Name "PASS" ("HTTP {0}" -f $code) }
        else { Write-Check $Name "FAIL" ("unexpected HTTP {0}" -f $code) }
    } catch {
        $code = 0
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        if ($Expected -contains $code) { Write-Check $Name "PASS" ("HTTP {0}" -f $code) }
        elseif ($code -eq 0) { Write-Check $Name "FAIL" $_.Exception.Message }
        else { Write-Check $Name "WARN" ("HTTP {0}; integration is not ready" -f $code) }
    }
}

Write-Host "CloudSentinels review preflight (read-only)" -ForegroundColor Cyan
Write-Host ("Branch: {0}" -f (git branch --show-current))
Write-Host ("Commit: {0}" -f (git rev-parse --short HEAD))
if ((git status --porcelain).Count -eq 0) { Write-Check "Git working tree" "PASS" "clean" }
else { Write-Check "Git working tree" "WARN" "uncommitted changes present" }

Test-Http "Go API liveness" "http://127.0.0.1:8082/healthz"
Test-Http "Go API readiness (Firebase required)" "http://127.0.0.1:8082/readyz"
Test-Http "Local n8n" "http://127.0.0.1:5678/healthz"
Test-Http "Local frontend" "http://127.0.0.1:5173"

foreach ($context in @("docker-desktop", "cloudsentinels-local")) {
    try {
        $nodes = kubectl get nodes --context $context -o json | ConvertFrom-Json
        $total = @($nodes.items).Count
        $ready = @($nodes.items | Where-Object { @($_.status.conditions | Where-Object { $_.type -eq "Ready" -and $_.status -eq "True" }).Count -gt 0 }).Count
        if ($total -gt 0 -and $ready -eq $total) { Write-Check ("Kubernetes " + $context) "PASS" ("{0}/{1} nodes Ready" -f $ready, $total) }
        else { Write-Check ("Kubernetes " + $context) "FAIL" ("{0}/{1} nodes Ready" -f $ready, $total) }
    } catch { Write-Check ("Kubernetes " + $context) "FAIL" $_.Exception.Message }
}

$agents = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq "cloudsentinels-agent.exe" })
if ($agents.Count -ge 2) { Write-Check "Local cluster agents" "PASS" ("{0} agent processes" -f $agents.Count) }
else { Write-Check "Local cluster agents" "WARN" ("{0} agent processes; expected two" -f $agents.Count) }

if (Get-Command aws -ErrorAction SilentlyContinue) {
    $identity = aws sts get-caller-identity --profile $AwsProfile --region $AwsRegion --query Arn --output text --no-cli-pager 2>$null
    if ($LASTEXITCODE -eq 0 -and $identity) {
        if ($identity -match ":root$") { Write-Check "AWS identity" "WARN" "root identity detected; read-only checks only, no deployment or poller actions" }
        else { Write-Check "AWS identity" "PASS" "non-root authenticated identity" }

        $stacks = aws cloudformation list-stacks --profile $AwsProfile --region $AwsRegion --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE --query "StackSummaries[?contains(StackName, 'cloudsentinels')].[StackName,StackStatus]" --output text --no-cli-pager 2>$null
        if ($LASTEXITCODE -eq 0) { Write-Check "AWS CloudFormation inventory" "PASS" (($stacks -join "; ").Trim()) }
        else { Write-Check "AWS CloudFormation inventory" "WARN" "unable to list stacks" }

        $routes = aws apigatewayv2 get-routes --api-id $AwsApiId --profile $AwsProfile --region $AwsRegion --query "Items[].RouteKey" --output text --no-cli-pager 2>$null
        if ($LASTEXITCODE -eq 0) {
            if ($routes -match "GET /automation/events" -and $routes -match "POST /telemetry/events") { Write-Check "Hosted API routes" "PASS" "automation events and telemetry routes deployed" }
            else { Write-Check "Hosted API routes" "WARN" "current automation/telemetry routes are not fully deployed" }
        } else { Write-Check "Hosted API routes" "WARN" "unable to read API Gateway routes" }

        $function = aws lambda get-function-configuration --function-name cloudsentinels-runtime-OperationsFunction-BPRtB7QthrQ3 --profile $AwsProfile --region $AwsRegion --query "{State:State,LastModified:LastModified}" --output json --no-cli-pager 2>$null | ConvertFrom-Json
        if ($LASTEXITCODE -eq 0 -and $function.State -eq "Active") { Write-Check "Hosted Operations Lambda" "PASS" ("Active; last modified {0}" -f $function.LastModified) }
        else { Write-Check "Hosted Operations Lambda" "WARN" "not active or unable to inspect" }

        $queue = aws sqs get-queue-attributes --queue-url $AwsQueueUrl --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible --profile $AwsProfile --region $AwsRegion --query "Attributes" --output json --no-cli-pager 2>$null | ConvertFrom-Json
        if ($LASTEXITCODE -eq 0) { Write-Check "AWS-to-n8n queue" "PASS" ("visible={0}; in-flight={1}" -f $queue.ApproximateNumberOfMessages, $queue.ApproximateNumberOfMessagesNotVisible) }
        else { Write-Check "AWS-to-n8n queue" "WARN" "unable to inspect queue" }

        $clusters = aws eks list-clusters --profile $AwsProfile --region $AwsRegion --query "clusters" --output json --no-cli-pager 2>$null | ConvertFrom-Json
        if ($LASTEXITCODE -eq 0 -and @($clusters).Count -eq 0) { Write-Check "Hosted EKS" "WARN" "no EKS cluster currently provisioned in $AwsRegion" }
        elseif ($LASTEXITCODE -eq 0) { Write-Check "Hosted EKS" "PASS" ((@($clusters) -join ", ")) }
        else { Write-Check "Hosted EKS" "WARN" "unable to list EKS clusters" }
    } else { Write-Check "AWS identity" "WARN" "profile is not authenticated; hosted checks skipped" }
} else { Write-Check "AWS CLI" "WARN" "not installed; hosted checks skipped" }

Write-Host ""
Write-Host ("Summary: {0} failure(s), {1} warning(s)" -f $script:Failures, $script:Warnings) -ForegroundColor Cyan
Write-Host "This script is read-only. It never deploys stacks, starts EC2, creates EKS, consumes SQS messages, or runs remediation."
if ($script:Failures -gt 0) { exit 1 }
