[CmdletBinding()]
param([string]$Region = "ap-south-1",[string]$CoreStackName = "cloudsentinels-core",[string]$RuntimeStackName = "cloudsentinels-runtime")
$ErrorActionPreference = "Stop"
foreach ($stack in @($CoreStackName,$RuntimeStackName)) {
  $state = aws cloudformation describe-stacks --stack-name $stack --region $Region --query "Stacks[0].StackStatus" --output text 2>$null
  if ($LASTEXITCODE -ne 0) { $state = "NOT_DEPLOYED" }
  Write-Host "$stack : $state"
}
$functionName = aws cloudformation describe-stacks --stack-name $RuntimeStackName --region $Region --query "Stacks[0].Outputs[?OutputKey=='OperationsFunctionName'].OutputValue | [0]" --output text 2>$null
if ($LASTEXITCODE -eq 0 -and $functionName -and $functionName -ne "None") {
  $reserved = aws lambda get-function-concurrency --function-name $functionName --region $Region --query "ReservedConcurrentExecutions" --output text 2>$null
  if ($LASTEXITCODE -ne 0 -or $reserved -eq "None") { Write-Host "Lambda runtime : ON (unreserved concurrency)" }
  elseif ($reserved -eq "0") { Write-Host "Lambda runtime : PAUSED" }
  else { Write-Host "Lambda runtime : RESERVED CONCURRENCY $reserved" }
}
