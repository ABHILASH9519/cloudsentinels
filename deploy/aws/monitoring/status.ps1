[CmdletBinding()]
param(
  [string]$InstanceId = "i-04ddd1baceeaa4186",
  [string]$CentralRegion = "ap-south-1",
  [string]$ServerRegion = "eu-north-1",
  [string]$MonitoringStackName = "cloudsentinels-aws-monitoring",
  [string]$ServerStackName = "cloudsentinels-aws-server-monitor",
  [string]$N8NBridgeStackName = "cloudsentinels-n8n-bridge"
)
$ErrorActionPreference = "Continue"
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw "AWS CLI v2 is required." }
$identity = aws sts get-caller-identity --region $CentralRegion --query Account --output text 2>$null
if ($LASTEXITCODE -ne 0 -or -not $identity) { throw "AWS CLI credentials are unavailable. Reauthenticate before checking status." }

foreach ($entry in @(@{Name=$MonitoringStackName;Region=$CentralRegion},@{Name=$ServerStackName;Region=$ServerRegion},@{Name=$N8NBridgeStackName;Region=$CentralRegion})) {
  $status = aws cloudformation describe-stacks --stack-name $entry.Name --region $entry.Region --query "Stacks[0].StackStatus" --output text 2>$null
  if ($LASTEXITCODE -ne 0) { $status = "NOT_DEPLOYED_OR_ACCESS_DENIED" }
  Write-Host "$($entry.Name) [$($entry.Region)] : $status"
}

$instanceState = aws ec2 describe-instances --instance-ids $InstanceId --region $ServerRegion --query "Reservations[0].Instances[0].State.Name" --output text 2>$null
if ($LASTEXITCODE -ne 0) { $instanceState = "NOT_FOUND_OR_ACCESS_DENIED" }
Write-Host "EC2 $InstanceId [$ServerRegion] : $instanceState"

foreach ($region in @($CentralRegion,$ServerRegion)) {
  Write-Host "CloudWatch alarms [$region]"
  aws cloudwatch describe-alarms --alarm-name-prefix cloudsentinels-aws- --region $region --query "MetricAlarms[].{Name:AlarmName,State:StateValue,Reason:StateReason}" --output table 2>$null
  aws cloudwatch describe-alarms --alarm-name-prefix cloudsentinels-lambda- --region $region --query "MetricAlarms[].{Name:AlarmName,State:StateValue,Reason:StateReason}" --output table 2>$null
  aws cloudwatch describe-alarms --alarm-name-prefix cloudsentinels-n8n- --region $region --query "MetricAlarms[].{Name:AlarmName,State:StateValue,Reason:StateReason}" --output table 2>$null
}
