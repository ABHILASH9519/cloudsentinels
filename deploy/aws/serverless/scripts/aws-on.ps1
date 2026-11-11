[CmdletBinding()]
param(
  [string]$Region = "ap-south-1",
  [Parameter(Mandatory=$true)][string]$AppOrigin,
  [Parameter(Mandatory=$true)][string]$CognitoDomainPrefix,
  [string]$LocalDevOrigin = "http://localhost:5173",
  [string]$CoreStackName = "cloudsentinels-core",
  [string]$RuntimeStackName = "cloudsentinels-runtime",
  [string]$DeploymentRoleArn = "",
  [string]$ClusterAgentSecretArn = "",
  [string]$BedrockModelId = "in.anthropic.claude-sonnet-5",
  [string]$ZapierWebhookSecretArn = "",
  [string]$ZapierCommandSecretArn = "",
  [string]$RemediationAdapterFunctionArn = "",
  [string]$RemediationExecutionEnabled = "false"
)
$ErrorActionPreference = "Stop"
if (-not (Get-Command "aws" -ErrorAction SilentlyContinue)) { throw "AWS CLI v2 is required." }
$identity = aws sts get-caller-identity --region $Region --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $identity.Account) { throw "AWS credentials are not configured or access is denied." }
if (-not $DeploymentRoleArn) { $DeploymentRoleArn = "arn:aws:iam::$($identity.Account):role/cloudsentinels/CloudSentinelsDeploymentRole" }
$ArtifactBucket = "cloudsentinels-sam-artifacts-$($identity.Account)"
$TemplateDir = Split-Path -Parent $PSScriptRoot
Push-Location $TemplateDir
try {
  Write-Host "Using CloudFormation execution role: $DeploymentRoleArn"
  Write-Host "Ensuring private deployment artifact bucket exists..."
  $bucketFound = aws s3api list-buckets --query "Buckets[?Name=='$ArtifactBucket'].Name | [0]" --output text
  if ($LASTEXITCODE -ne 0) { throw "Could not list S3 buckets." }
  if ($bucketFound -eq "None") {
    aws s3api create-bucket --bucket $ArtifactBucket --region $Region --create-bucket-configuration "LocationConstraint=$Region" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not create deployment artifact bucket." }
  }
  aws s3api put-public-access-block --bucket $ArtifactBucket --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" --region $Region
  if ($LASTEXITCODE -ne 0) { throw "Could not block public access to artifact bucket." }
  $encryptionPath = Join-Path $env:TEMP "cloudsentinels-s3-encryption.json"
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' | Set-Content -Path $encryptionPath -Encoding ascii
  aws s3api put-bucket-encryption --bucket $ArtifactBucket --server-side-encryption-configuration "file://$encryptionPath" --region $Region
  if ($LASTEXITCODE -ne 0) { throw "Could not encrypt artifact bucket." }
  aws s3api put-bucket-versioning --bucket $ArtifactBucket --versioning-configuration "Status=Enabled" --region $Region
  if ($LASTEXITCODE -ne 0) { throw "Could not enable artifact bucket versioning." }

  Write-Host "Ensuring persistent Cognito + DynamoDB foundation exists..."
  aws cloudformation deploy --template-file core-template.yaml --stack-name $CoreStackName --parameter-overrides "AppOrigin=$AppOrigin" "LocalDevOrigin=$LocalDevOrigin" "CognitoDomainPrefix=$CognitoDomainPrefix" --role-arn $DeploymentRoleArn --region $Region --no-fail-on-empty-changeset
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

  Write-Host "Packaging Lambda code with AWS CloudFormation..."
  $packagedTemplate = Join-Path $TemplateDir "packaged-runtime.yaml"
  aws cloudformation package --template-file runtime-template.yaml --s3-bucket $ArtifactBucket --s3-prefix cloudsentinels-runtime --output-template-file $packagedTemplate --region $Region
  if ($LASTEXITCODE -ne 0) { throw "Runtime packaging failed." }
  aws cloudformation validate-template --template-body "file://$packagedTemplate" --region $Region | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Packaged runtime template validation failed." }

  Write-Host "Deploying API, Lambda, EventBridge, SQS and automation processor..."
  aws cloudformation deploy --template-file $packagedTemplate --stack-name $RuntimeStackName --parameter-overrides "AppOrigin=$AppOrigin" "LocalDevOrigin=$LocalDevOrigin" "ApplicationTableName=$table" "CognitoIssuer=$issuer" "UserPoolClientId=$client" "BedrockModelId=$BedrockModelId" "ClusterAgentSecretArn=$ClusterAgentSecretArn" "ZapierWebhookSecretArn=$ZapierWebhookSecretArn" "ZapierCommandSecretArn=$ZapierCommandSecretArn" "RemediationAdapterFunctionArn=$RemediationAdapterFunctionArn" "RemediationExecutionEnabled=$RemediationExecutionEnabled" --capabilities CAPABILITY_IAM --role-arn $DeploymentRoleArn --region $Region --no-fail-on-empty-changeset
  if ($LASTEXITCODE -ne 0) { throw "Runtime deployment failed. Persistent core resources were left intact." }

  $runtime = aws cloudformation describe-stacks --stack-name $RuntimeStackName --region $Region --query "Stacks[0].Outputs" --output json | ConvertFrom-Json
  $api = ($runtime | Where-Object { $_.OutputKey -eq "ApiBaseUrl" } | Select-Object -First 1).OutputValue
  $functionName = ($runtime | Where-Object { $_.OutputKey -eq "OperationsFunctionName" } | Select-Object -First 1).OutputValue
  if (-not $api -or -not $functionName) { throw "Runtime API/function outputs are missing." }

  Write-Host ""
  Write-Host "CloudSentinels AWS runtime is ON." -ForegroundColor Green
  Write-Host "Configure these public frontend values in Vercel Preview for the deployment branch:"
  Write-Host "VITE_AWS_REGION=$Region"
  Write-Host "VITE_COGNITO_USER_POOL_ID=$pool"
  Write-Host "VITE_COGNITO_CLIENT_ID=$client"
  Write-Host "VITE_COGNITO_DOMAIN=$domain"
  Write-Host "VITE_AWS_API_URL=$api"
  Write-Host ""
  Write-Host "When finished: .\scripts\aws-off.ps1 -Region $Region"
  Write-Host "Pausing Lambda does not delete users, data, API Gateway, or CloudFormation stacks."
} finally { Pop-Location }
