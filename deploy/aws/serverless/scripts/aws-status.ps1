[CmdletBinding()]
param([string]$Region = "ap-south-1",[string]$CoreStackName = "cloudsentinels-core",[string]$RuntimeStackName = "cloudsentinels-runtime")
$ErrorActionPreference = "Stop"
foreach ($stack in @($CoreStackName,$RuntimeStackName)) {
  $state = aws cloudformation describe-stacks --stack-name $stack --region $Region --query "Stacks[0].StackStatus" --output text 2>$null
  if ($LASTEXITCODE -ne 0) { $state = "NOT_DEPLOYED" }
  Write-Host "$stack : $state"
}
