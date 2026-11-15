[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$AwsProfile,
  [string]$QueueUrl,
  [string]$Region = "ap-south-1",
  [string]$StackName = "cloudsentinels-n8n-bridge"
)
$ErrorActionPreference = "Stop"
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw "AWS CLI v2 is required." }
$identity = aws sts get-caller-identity --profile $AwsProfile --region $Region --query Account --output text --no-cli-pager
$identityArn = aws sts get-caller-identity --profile $AwsProfile --region $Region --query Arn --output text --no-cli-pager
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($identity)) { throw "AWS profile is not authenticated. Run aws login --profile $AwsProfile first." }
if ($identity -ne "115484989078" -or $identityArn -match ':root$') { throw "Refusing to start the CloudSentinels AWS poller for unexpected or root identity $identityArn." }
if ([string]::IsNullOrWhiteSpace($QueueUrl)) {
  $query = "Stacks[0].Outputs[?OutputKey=='N8NEventQueueUrl'].OutputValue | [0]"
  $QueueUrl = aws cloudformation describe-stacks --stack-name $StackName --profile $AwsProfile --region $Region --query $query --output text --no-cli-pager
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($QueueUrl) -or $QueueUrl -eq "None") { throw "Could not read N8NEventQueueUrl. Supply -QueueUrl or grant cloudformation:DescribeStacks." }
}
if ($QueueUrl -notmatch "^https://sqs\.$([regex]::Escape($Region))\.") { throw "QueueUrl must be an HTTPS SQS URL in region $Region." }
aws sqs get-queue-attributes --queue-url $QueueUrl --attribute-names QueueArn --profile $AwsProfile --region $Region --output json --no-cli-pager | Out-Null
if ($LASTEXITCODE -ne 0) { throw "AWS profile cannot read the dedicated n8n queue. Check the least-privilege SQS policy." }
try { $health = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:5678/healthz" -TimeoutSec 5; if ($health.StatusCode -ne 200) { throw "n8n health check failed." } } catch { throw "Local n8n must be running and healthy before starting the AWS poller." }
$stateDir = Join-Path $env:LOCALAPPDATA "CloudSentinels\aws"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$pidFile = Join-Path $stateDir "n8n-sqs-poller.pid"
$stdout = Join-Path $stateDir "n8n-sqs-poller.log"
$stderr = Join-Path $stateDir "n8n-sqs-poller.err"
if (Test-Path $pidFile) {
  $oldPid = 0
  [void][int]::TryParse((Get-Content -Raw $pidFile).Trim(), [ref]$oldPid)
  if ($oldPid -gt 0 -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    Write-Output "AWS_N8N_POLLER_ALREADY_RUNNING pid=$oldPid"
    exit 0
  }
}
$poller = Join-Path $PSScriptRoot "poll-aws-events.ps1"
$arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $poller, "-QueueUrl", $QueueUrl, "-Region", $Region, "-AwsProfile", $AwsProfile)
$process = Start-Process -FilePath (Get-Command powershell.exe).Source -ArgumentList $arguments -WorkingDirectory (Resolve-Path (Join-Path $PSScriptRoot "..\..")) -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
Start-Sleep -Seconds 3
if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
  Get-Content $stderr -Tail 30 -ErrorAction SilentlyContinue
  throw "AWS SQS poller exited during startup. See $stderr."
}
[IO.File]::WriteAllText($pidFile, [string]$process.Id)
Write-Output "AWS_N8N_POLLER_STARTED pid=$($process.Id) region=$Region queue=CloudSentinels dedicated n8n queue"
Write-Output "LOG=$stdout"