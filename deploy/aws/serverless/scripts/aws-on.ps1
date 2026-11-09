[CmdletBinding()]
param(
  [string]$Region = "ap-south-1",
  [Parameter(Mandatory=$true)][string]$AppOrigin,
  [Parameter(Mandatory=$true)][string]$CognitoDomainPrefix,
  [string]$LocalDevOrigin = "http://localhost:5173",
  [string]$CoreStackName = "cloudsentinels-core",
  [string]$RuntimeStackName = "cloudsentinels-runtime"
)
$ErrorActionPreference = "Stop"
foreach ($tool in @("aws", "sam")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool CLI is required. Install/configure AWS CLI and AWS SAM CLI first." }
}
$TemplateDir = Split-Path -Parent $PSScriptRoot
Push-Location $TemplateDir
try {
  aws sts get-caller-identity --region $Region | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "AWS credentials are not configured or access is denied." }

  Write-Host "Ensuring persistent identity + data foundation exists..."
  aws cloudformation deploy --template-file core-template.yaml --stack-name $CoreStackName --parameter-overrides "AppOrigin=$AppOrigin" "LocalDevOrigin=$LocalDevOrigin" "CognitoDomainPrefix=$CognitoDomainPrefix" --region $Region --no-fail-on-empty-changeset
  if ($LASTEXITCODE -ne 0) { throw "Persistent core deployment failed." }

  $core = aws cloudformation describe-stacks --stack-name $CoreStackName --region $Region --query "Stacks[0].Outputs" --output json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw "Could not read persistent core stack outputs." }
  function OutputValue($key) { return ($core | Where-Object { $_.OutputKey -eq $key } | Select-Object -First 1).OutputValue }
  $table = OutputValue "ApplicationTableName"
  $issuer = OutputValue "CognitoIssuer"
  $client = OutputValue "UserPoolClientId"
  $pool = OutputValue "UserPoolId"
  $domain = OutputValue "CognitoHostedUi"
  if (-not $table -or -not $issuer -or -not $client -or -not $pool -or -not $domain) { throw "One or more core stack outputs are missing." }

  Write-Host "Building the stable API + Lambda runtime..."
  sam build --template-file runtime-template.yaml
  if ($LASTEXITCODE -ne 0) { throw "SAM build failed." }

  Write-Host "Deploying/updating the stable API + Lambda runtime..."
  sam deploy --template-file .aws-sam/build/template.yaml --stack-name $RuntimeStackName --resolve-s3 --capabilities CAPABILITY_IAM --region $Region --no-confirm-changeset --no-fail-on-empty-changeset --parameter-overrides "AppOrigin=$AppOrigin" "LocalDevOrigin=$LocalDevOrigin" "ApplicationTableName=$table" "CognitoIssuer=$issuer" "UserPoolClientId=$client"
  if ($LASTEXITCODE -ne 0) { throw "Runtime deployment failed. Persistent core resources were left intact." }

  $runtime = aws cloudformation describe-stacks --stack-name $RuntimeStackName --region $Region --query "Stacks[0].Outputs" --output json | ConvertFrom-Json
  $api = ($runtime | Where-Object { $_.OutputKey -eq "ApiBaseUrl" } | Select-Object -First 1).OutputValue
  $functionName = ($runtime | Where-Object { $_.OutputKey -eq "OperationsFunctionName" } | Select-Object -First 1).OutputValue
  if (-not $api -or -not $functionName) { throw "Runtime API/function outputs are missing." }

  Write-Host "Resuming Lambda execution..."
  aws lambda delete-function-concurrency --function-name $functionName --region $Region 2>$null
  if ($LASTEXITCODE -ne 0) { throw "Could not resume Lambda. Check function permissions and stack status." }

  Write-Host ""
  Write-Host "CloudSentinels AWS runtime is ON." -ForegroundColor Green
  Write-Host "API URL remains stable across pause/resume. Configure these Vercel/local frontend values once:"
  Write-Host "VITE_AWS_REGION=$Region"
  Write-Host "VITE_COGNITO_USER_POOL_ID=$pool"
  Write-Host "VITE_COGNITO_CLIENT_ID=$client"
  Write-Host "VITE_COGNITO_DOMAIN=$domain"
  Write-Host "VITE_AWS_API_URL=$api"
  Write-Host ""
  Write-Host "When finished: .\scripts\aws-off.ps1 -Region $Region"
  Write-Host "This pauses Lambda; it does not delete your users, data, API URL, or stack."
} finally { Pop-Location }
