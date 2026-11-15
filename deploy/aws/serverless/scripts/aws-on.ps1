[CmdletBinding()]
param(
  [string]$Region = "ap-south-1",
  [Parameter(Mandatory=$true)][string]$AppOrigin,
  [Parameter(Mandatory=$true)][string]$CognitoDomainPrefix,
  [Parameter(Mandatory=$true)][string]$FirebaseProjectID,
  [string]$LocalDevOrigin = "http://localhost:5173",
  [string]$CoreStackName = "cloudsentinels-core",
  [string]$RuntimeStackName = "cloudsentinels-runtime",
  [string]$DeploymentRoleArn = "",
  [string]$AwsProfile = "",
  [string]$ClusterAgentSecretArn = "",
  [string]$BedrockModelId = "in.anthropic.claude-sonnet-5",
  [string]$ZapierWebhookSecretArn = "",
  [string]$ZapierCommandSecretArn = "",
  [string]$RemediationAdapterFunctionArn = "",
  [string]$RemediationExecutionEnabled = "false",
  [string]$UseBuiltInDryRunAdapter = "false"
)
$ErrorActionPreference = "Stop"
if (-not (Get-Command "aws" -ErrorAction SilentlyContinue)) { throw "AWS CLI v2 is required." }
if (-not [string]::IsNullOrWhiteSpace($AwsProfile)) { $env:AWS_PROFILE = $AwsProfile }
if ([string]::IsNullOrWhiteSpace($FirebaseProjectID)) { throw "FirebaseProjectID is required for the current Firebase JWT runtime." }
$identity = aws sts get-caller-identity --region $Region --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $identity.Account) { throw "AWS credentials are not configured or access is denied." }
if ($identity.Arn -match ":root$") { throw "Refusing AWS deployment with the root identity. Authenticate with a dedicated least-privilege deployment role." }
if (-not $DeploymentRoleArn) { $DeploymentRoleArn = "arn:aws:iam::$($identity.Account):role/cloudsentinels/CloudSentinelsDeploymentRole" }
$ArtifactBucket = "cloudsentinels-sam-artifacts-$($identity.Account)"
$TemplateDir = Split-Path -Parent $PSScriptRoot
Push-Location $TemplateDir
try {
  Write-Host "Using non-root AWS identity: $($identity.Arn)"
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

  Write-Host "Ensuring persistent data foundation exists (legacy Cognito resources are retained; current runtime auth is Firebase)..."
  aws cloudformation deploy --template-file core-template.yaml --stack-name $CoreStackName --parameter-overrides "AppOrigin=$AppOrigin" "LocalDevOrigin=$LocalDevOrigin" "CognitoDomainPrefix=$CognitoDomainPrefix" --role-arn $DeploymentRoleArn --region $Region --no-fail-on-empty-changeset
  if ($LASTEXITCODE -ne 0) { throw "Persistent core deployment failed." }

  $core = aws cloudformation describe-stacks --stack-name $CoreStackName --region $Region --query "Stacks[0].Outputs" --output json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw "Could not read persistent core stack outputs." }
  $table = ($core | Where-Object { $_.OutputKey -eq "ApplicationTableName" } | Select-Object -First 1).OutputValue
  if (-not $table) { throw "ApplicationTableName core stack output is missing." }

  Write-Host "Packaging Lambda code with AWS CloudFormation..."
  $packagedTemplate = Join-Path $TemplateDir "packaged-runtime.yaml"
  aws cloudformation package --template-file runtime-template.yaml --s3-bucket $ArtifactBucket --s3-prefix cloudsentinels-runtime --output-template-file $packagedTemplate --region $Region
  if ($LASTEXITCODE -ne 0) { throw "Runtime packaging failed." }
  aws cloudformation validate-template --template-body "file://$packagedTemplate" --region $Region | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Packaged runtime template validation failed." }

  Write-Host "Deploying Firebase JWT API, Lambda, EventBridge, SQS and automation processor..."
  aws cloudformation deploy --template-file $packagedTemplate --stack-name $RuntimeStackName --parameter-overrides "AppOrigin=$AppOrigin" "LocalDevOrigin=$LocalDevOrigin" "ApplicationTableName=$table" "FirebaseProjectID=$FirebaseProjectID" "BedrockModelId=$BedrockModelId" "ClusterAgentSecretArn=$ClusterAgentSecretArn" "ZapierWebhookSecretArn=$ZapierWebhookSecretArn" "ZapierCommandSecretArn=$ZapierCommandSecretArn" "RemediationAdapterFunctionArn=$RemediationAdapterFunctionArn" "RemediationExecutionEnabled=$RemediationExecutionEnabled" "UseBuiltInDryRunAdapter=$UseBuiltInDryRunAdapter" --capabilities CAPABILITY_IAM --role-arn $DeploymentRoleArn --region $Region --no-fail-on-empty-changeset
  if ($LASTEXITCODE -ne 0) { throw "Runtime deployment failed. Persistent core resources were left intact." }

  $runtime = aws cloudformation describe-stacks --stack-name $RuntimeStackName --region $Region --query "Stacks[0].Outputs" --output json | ConvertFrom-Json
  $api = ($runtime | Where-Object { $_.OutputKey -eq "ApiBaseUrl" } | Select-Object -First 1).OutputValue
  $functionName = ($runtime | Where-Object { $_.OutputKey -eq "OperationsFunctionName" } | Select-Object -First 1).OutputValue
  if (-not $api -or -not $functionName) { throw "Runtime API/function outputs are missing." }

  Write-Host ""
  Write-Host "CloudSentinels AWS runtime is ON." -ForegroundColor Green
  Write-Host "Configure these public frontend values in Vercel Preview for the deployment branch:"
  Write-Host "VITE_AWS_REGION=$Region"
  Write-Host "VITE_AWS_API_URL=$api"
  Write-Host "VITE_FIREBASE_PROJECT_ID=$FirebaseProjectID"
  Write-Host "Also set VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, and VITE_FIREBASE_APP_ID from the Firebase Web App config."
  Write-Host ""
  Write-Host "When finished: .\scripts\aws-off.ps1 -Region $Region"
  Write-Host "Pausing Lambda does not delete users, data, API Gateway, or CloudFormation stacks."
} finally { Pop-Location }
