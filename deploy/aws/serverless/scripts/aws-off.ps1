[CmdletBinding()]
param(
  [string]$Region = "ap-south-1",
  [string]$RuntimeStackName = "cloudsentinels-runtime",
  [string]$AwsProfile = ""
)
$ErrorActionPreference = "Stop"
if (-not (Get-Command "aws" -ErrorAction SilentlyContinue)) { throw "AWS CLI v2 is required." }
if (-not [string]::IsNullOrWhiteSpace($AwsProfile)) { $env:AWS_PROFILE = $AwsProfile }
$identity = aws sts get-caller-identity --region $Region --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $identity.Account) { throw "AWS credentials are not configured or access is denied." }
if ($identity.Arn -match ":root$") { throw "Refusing to pause the hosted runtime with the root identity. Authenticate with a dedicated least-privilege operator role." }
$functionName = aws cloudformation describe-stacks --stack-name $RuntimeStackName --region $Region --query "Stacks[0].Outputs[?OutputKey=='OperationsFunctionName'].OutputValue | [0]" --output text 2>$null
if ($LASTEXITCODE -ne 0 -or -not $functionName -or $functionName -eq "None") {
  Write-Host "CloudSentinels runtime stack is not deployed. Nothing to pause."
  exit 0
}
Write-Host "Pausing Lambda execution (the API URL, Firebase auth configuration and DynamoDB data are preserved)..."
aws lambda put-function-concurrency --function-name $functionName --reserved-concurrent-executions 0 --region $Region | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not pause Lambda. Check IAM permissions and function status." }
Write-Host "CloudSentinels AWS runtime is PAUSED." -ForegroundColor Yellow
Write-Host "Lambda invocations are blocked until aws-on.ps1 resumes it."
Write-Host "Close the app/browser while paused to avoid unnecessary API Gateway request charges."
Write-Host "Persistent DynamoDB data remains intact."
