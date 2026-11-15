[CmdletBinding()]
param(
  [string]$InstanceId = "i-04ddd1baceeaa4186",
  [Parameter(Mandatory=$true)][string]$AutomationOwnerId,
  [string]$CentralRegion = "ap-south-1",
  [string]$ServerRegion = "eu-north-1",
  [string]$CoreStackName = "cloudsentinels-core",
  [string]$RuntimeStackName = "cloudsentinels-runtime",
  [string]$MonitoringStackName = "cloudsentinels-aws-monitoring",
  [string]$ServerStackName = "cloudsentinels-aws-server-monitor"
)
$ErrorActionPreference = "Stop"

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw "AWS CLI v2 is required." }
if ($AutomationOwnerId -notmatch '^[A-Za-z0-9._:@+-]{1,128}$') { throw "AutomationOwnerId must be the authenticated CloudSentinels user subject/UID." }
if ($InstanceId -notmatch '^i-[0-9a-f]{8,17}$') { throw "InstanceId is not a valid EC2 instance ID." }

$identity = aws sts get-caller-identity --region $CentralRegion --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $identity.Account) { throw "AWS CLI credentials are unavailable. Reauthenticate with aws login or your configured SSO profile." }

function Get-StackOutput([string]$StackName, [string]$OutputKey, [string]$Region) {
  $json = aws cloudformation describe-stacks --stack-name $StackName --region $Region --query "Stacks[0].Outputs" --output json
  if ($LASTEXITCODE -ne 0) { throw "Could not read CloudFormation stack '$StackName' in $Region." }
  $outputs = $json | ConvertFrom-Json
  $value = ($outputs | Where-Object { $_.OutputKey -eq $OutputKey } | Select-Object -First 1).OutputValue
  if (-not $value) { throw "Stack '$StackName' is missing output '$OutputKey'." }
  return $value
}

$tableName = Get-StackOutput $CoreStackName "ApplicationTableName" $CentralRegion
$busName = Get-StackOutput $RuntimeStackName "EventBusName" $CentralRegion
$operationsFunction = Get-StackOutput $RuntimeStackName "OperationsFunctionName" $CentralRegion
$automationFunction = Get-StackOutput $RuntimeStackName "AutomationProcessorFunctionName" $CentralRegion
$busArn = aws events describe-event-bus --name $busName --region $CentralRegion --query Arn --output text
if ($LASTEXITCODE -ne 0 -or -not $busArn -or $busArn -eq "None") { throw "Could not resolve the existing central EventBridge bus ARN." }

$artifactBucket = "cloudsentinels-sam-artifacts-$($identity.Account)"
aws s3api head-bucket --bucket $artifactBucket --region $CentralRegion 2>$null
if ($LASTEXITCODE -ne 0) { throw "Expected existing private artifact bucket '$artifactBucket' was not found or is inaccessible. Do not create a new bucket without reviewing cost and ownership." }

$processorDir = Join-Path $PSScriptRoot "processor"
Write-Host "Installing pinned AWS SDK dependencies and running monitoring processor tests..."
if (Test-Path (Join-Path $processorDir "package-lock.json")) {
  npm ci --omit=dev --no-audit --no-fund --prefix $processorDir
} else {
  npm install --omit=dev --no-audit --no-fund --prefix $processorDir
}
if ($LASTEXITCODE -ne 0) { throw "AWS monitoring processor dependency installation failed." }
npm test --prefix $processorDir
if ($LASTEXITCODE -ne 0) { throw "AWS monitoring processor tests failed." }

$packagedTemplate = Join-Path $env:TEMP "cloudsentinels-aws-monitoring-$PID.yaml"
$centralTemplate = Join-Path $PSScriptRoot "central-template.yaml"
Write-Host "Packaging the central AWS monitoring Lambda..."
aws cloudformation package --template-file $centralTemplate --s3-bucket $artifactBucket --s3-prefix cloudsentinels-aws-monitoring --output-template-file $packagedTemplate --region $CentralRegion
if ($LASTEXITCODE -ne 0) { throw "Central monitoring Lambda packaging failed." }
aws cloudformation validate-template --template-body "file://$packagedTemplate" --region $CentralRegion | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Central monitoring template validation failed." }

Write-Host "Deploying additive central monitoring resources in $CentralRegion..."
aws cloudformation deploy --template-file $packagedTemplate --stack-name $MonitoringStackName --parameter-overrides "ApplicationTableName=$tableName" "AutomationOwnerId=$AutomationOwnerId" "EventBusName=$busName" "InstanceId=$InstanceId" "OperationsFunctionName=$operationsFunction" "AutomationProcessorFunctionName=$automationFunction" --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --region $CentralRegion
if ($LASTEXITCODE -ne 0) { throw "Central monitoring stack deployment failed." }

Write-Host "Deploying read-only EC2 monitoring and cross-region forwarding in $ServerRegion..."
$serverTemplate = Join-Path $PSScriptRoot "server-template.yaml"
aws cloudformation validate-template --template-body "file://$serverTemplate" --region $ServerRegion | Out-Null
if ($LASTEXITCODE -ne 0) { throw "EC2 server monitoring template validation failed." }
aws cloudformation deploy --template-file $serverTemplate --stack-name $ServerStackName --parameter-overrides "InstanceId=$InstanceId" "CentralEventBusArn=$busArn" --capabilities CAPABILITY_NAMED_IAM --region $ServerRegion
if ($LASTEXITCODE -ne 0) { throw "EC2 server monitoring stack deployment failed. The central monitoring stack remains deployed." }

Write-Host ""
Write-Host "CloudSentinels AWS monitoring integration deployed." -ForegroundColor Green
Write-Host "EC2 instance: $InstanceId ($ServerRegion)"
Write-Host "Central EventBridge/Lambda pipeline: $CentralRegion"
Write-Host "Dashboard owner: configured authenticated subject/UID"
Write-Host "No EC2 start/stop, Lambda remediation, or production workload mutation was performed."
Write-Host "Use .\status.ps1 to inspect stack and instance status."
