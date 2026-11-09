[CmdletBinding()]
param([string]$Region = "ap-south-1",[string]$RuntimeStackName = "cloudsentinels-runtime")
$ErrorActionPreference = "Stop"
$functionName = aws cloudformation describe-stacks --stack-name $RuntimeStackName --region $Region --query "Stacks[0].Outputs[?OutputKey=='OperationsFunctionName'].OutputValue | [0]" --output text 2>$null
if ($LASTEXITCODE -ne 0 -or -not $functionName -or $functionName -eq "None") {
  Write-Host "CloudSentinels runtime stack is not deployed. Nothing to pause."
  exit 0
}
Write-Host "Pausing Lambda execution (the API URL and Cognito/data resources are preserved)..."
aws lambda put-function-concurrency --function-name $functionName --reserved-concurrent-executions 0 --region $Region | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not pause Lambda. Check IAM permissions and function status." }
Write-Host "CloudSentinels AWS runtime is PAUSED." -ForegroundColor Yellow
Write-Host "Lambda invocations are blocked until aws-on.ps1 resumes it."
Write-Host "Close the app/browser while paused to avoid unnecessary API Gateway request charges."
Write-Host "Cognito users and DynamoDB records remain intact."
