[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$QueueUrl,
  [string]$Region = "ap-south-1",
  [string]$AwsProfile,
  [string]$WebhookUrl = "http://127.0.0.1:5678/webhook/cloudsentinels/unified-events",
  [switch]$Once
)

$ErrorActionPreference = "Stop"
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw "AWS CLI v2 is required for the local SQS poller." }
$webhookUri = [Uri]$WebhookUrl
if ($webhookUri.Scheme -ne "http" -or $webhookUri.Host -notin @("127.0.0.1", "localhost")) {
  throw "The local AWS bridge only posts to the loopback n8n webhook."
}
if ($AwsProfile) { $env:AWS_PROFILE = $AwsProfile }
Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:5678/healthz" -TimeoutSec 5 | Out-Null

$stateDir = Join-Path $env:LOCALAPPDATA "CloudSentinels\agents"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$stateFile = Join-Path $stateDir "aws-event-dedupe.json"
$processed = @{}
if (Test-Path $stateFile) {
  try {
    $saved = Get-Content -Raw $stateFile | ConvertFrom-Json
    foreach ($id in @($saved.eventIds)) { if ($id) { $processed[[string]$id] = $true } }
  } catch { Write-Warning "Dedupe state file is unreadable; continuing with an empty local cache." }
}

function Save-ProcessedIds {
  $ids = @($processed.Keys | Select-Object -Last 5000)
  $json = @{ eventIds = $ids; updatedAt = (Get-Date).ToUniversalTime().ToString("o") } | ConvertTo-Json -Depth 5
  [System.IO.File]::WriteAllText($stateFile, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Delete-SqsMessage([string]$ReceiptHandle) {
  $argsList = @("sqs","delete-message","--queue-url",$QueueUrl,"--receipt-handle",$ReceiptHandle,"--region",$Region,"--output","text")
  if ($AwsProfile) { $argsList += @("--profile",$AwsProfile) }
  & aws @argsList 2>$null | Out-Null
  return ($LASTEXITCODE -eq 0)
}

Write-Output "AWS_N8N_POLLER_STARTED region=$Region webhook=$WebhookUrl"
do {
  $receiveArgs = @("sqs","receive-message","--queue-url",$QueueUrl,"--region",$Region,"--wait-time-seconds","20","--max-number-of-messages","10","--attribute-names","All","--message-attribute-names","All","--output","json")
  if ($AwsProfile) { $receiveArgs += @("--profile",$AwsProfile) }
  $raw = & aws @receiveArgs 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "AWS SQS receive failed; check the IAM profile/session. Messages remain in the queue."
    if ($Once) { break }
    Start-Sleep -Seconds 10
    continue
  }
  $batch = $null
  if ($raw) { try { $batch = ($raw -join [Environment]::NewLine) | ConvertFrom-Json } catch { Write-Warning "AWS SQS returned invalid JSON; no messages were deleted." } }
  $messages = @()
  if ($batch -and $batch.Messages) { $messages = @($batch.Messages) }

  foreach ($message in $messages) {
    $eventId = ""
    try {
      $event = $message.Body | ConvertFrom-Json
      $eventId = [string]$event.id
      if (-not $eventId) { $eventId = [string]$event.eventId }
      if ($eventId -and $processed.ContainsKey($eventId)) {
        if (Delete-SqsMessage $message.ReceiptHandle) { Write-Output "DUPLICATE_EVENT_DISCARDED id=$eventId" }
        continue
      }

      $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $WebhookUrl -ContentType "application/json" -Body $message.Body -TimeoutSec 30
      if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) { throw "n8n returned HTTP $($response.StatusCode)" }

      if ($eventId) {
        $processed[$eventId] = $true
        if ($processed.Count -gt 5000) {
          $keep = @($processed.Keys | Select-Object -Last 5000)
          $processed = @{}
          foreach ($id in $keep) { $processed[$id] = $true }
        }
        Save-ProcessedIds
      }
      if (Delete-SqsMessage $message.ReceiptHandle) {
        $eventType = [string]$event.'detail-type'
        if (-not $eventType) { $eventType = [string]$event.eventType }
        Write-Output "AWS_EVENT_FORWARDED id=$eventId type=$eventType"
      } else {
        Write-Warning "n8n accepted event $eventId, but SQS deletion failed; a duplicate may be delivered."
      }
    } catch {
      Write-Warning "Event $eventId was not acknowledged; it remains eligible for retry. $($_.Exception.Message)"
    }
  }

  if ($Once) { break }
} while ($true)
