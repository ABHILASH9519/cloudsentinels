[CmdletBinding()]
param(
  [string]$AwsProfile,
  [string]$InstanceId = "i-04ddd1baceeaa4186",
  [switch]$SkipServerForwarder
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw "AWS CLI v2 is required. Authenticate with an IAM role/profile first." }
if ($AwsProfile) { $env:AWS_PROFILE = $AwsProfile }

$identityArn = aws sts get-caller-identity --query Arn --output text
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($identityArn)) { throw "AWS identity check failed. Run aws sso login for a least-privileged deployment role." }
if ($identityArn -match ':root$') { throw "Refusing CloudFormation deployment with the AWS root identity. Use a dedicated least-privileged IAM role." }

$centralRegion = "ap-south-1"
$serverRegion = "eu-north-1"
$busArn = aws events describe-event-bus --name cloudsentinels-domain-events --region $centralRegion --query Arn --output text
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($busArn)) { throw "Existing CloudSentinels domain event bus was not found in $centralRegion." }

$template = Join-Path $PSScriptRoot "n8n-bridge-template.yaml"
aws cloudformation deploy --template-file $template --stack-name cloudsentinels-n8n-bridge --parameter-overrides ("DomainEventBusArn=" + $busArn) --region $centralRegion
if ($LASTEXITCODE -ne 0) { throw "Central n8n SQS/EventBridge bridge deployment failed." }

if (-not $SkipServerForwarder) {
  $serverTemplate = Join-Path $PSScriptRoot "server-template.yaml"
  aws cloudformation deploy --template-file $serverTemplate --stack-name cloudsentinels-aws-server-monitor --capabilities CAPABILITY_NAMED_IAM --parameter-overrides ("InstanceId=" + $InstanceId) --region $serverRegion
  if ($LASTEXITCODE -ne 0) { throw "EC2 cross-region EventBridge forwarder deployment failed." }
}

$queueUrl = aws cloudformation describe-stacks --stack-name cloudsentinels-n8n-bridge --region $centralRegion --query "Stacks[0].Outputs[?OutputKey=='N8NEventQueueUrl'].OutputValue" --output text
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($queueUrl)) { throw "Could not retrieve the n8n SQS queue URL." }
Write-Output "AWS_N8N_BRIDGE_DEPLOYED region=$centralRegion"
Write-Output "EC2_FORWARDER_DEPLOYED=$(-not $SkipServerForwarder) region=$serverRegion instance=$InstanceId"
Write-Output "N8N_EVENT_QUEUE_URL=$queueUrl"
Write-Output "Next: run deploy\automation\poll-aws-events.ps1 -QueueUrl <value> -Region $centralRegion"
