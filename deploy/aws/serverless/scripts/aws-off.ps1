[CmdletBinding()]
param(
  [string]$Region = "ap-south-1",
  [string]$RuntimeStackName = "cloudsentinels-runtime"
)
$ErrorActionPreference = "Stop"
$exists = aws cloudformation describe-stacks --stack-name $RuntimeStackName --region $Region --query "Stacks[0].StackStatus" --output text 2>$null
if ($LASTEXITCODE -ne 0 -or -not $exists) {
  Write-Host "CloudSentinels runtime is already OFF. Persistent Cognito and DynamoDB resources are untouched."
  exit 0
}
if ($exists -eq "DELETE_IN_PROGRESS") {
  Write-Host "Runtime deletion is already in progress."
  exit 0
}
Write-Host "Stopping temporary API Gateway + Lambda resources..."
aws cloudformation delete-stack --stack-name $RuntimeStackName --region $Region
if ($LASTEXITCODE -ne 0) { throw "Could not request runtime shutdown." }
aws cloudformation wait stack-delete-complete --stack-name $RuntimeStackName --region $Region
if ($LASTEXITCODE -ne 0) { throw "Runtime shutdown did not complete. Check CloudFormation stack events." }
Write-Host "CloudSentinels AWS runtime is OFF." -ForegroundColor Green
Write-Host "Persistent Cognito users and DynamoDB records were not deleted."
