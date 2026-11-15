const isEventBridge = Boolean(body && body.id && body.source && body["detail-type"]);
if (isEventBridge) {
  const envelope = body;
  const detail = parseObject(envelope.detail, "EventBridge detail");
  const alarmName = String(detail.alarmName || "");
  const state = detail.state && typeof detail.state === "object" ? detail.state.value : detail.state;
  const eventType = String(envelope["detail-type"] || "AWS EventBridge Event");
  let severity = "info";
  if (eventType.toLowerCase().includes("cloudwatch alarm") && state === "ALARM") {
    severity = /statuscheckfailed|errors|dead.?letter|dlq/i.test(alarmName) ? "critical" : "high";
  } else if (eventType.toLowerCase().includes("instance state-change")) {
    severity = detail.state === "terminated" ? "critical" : ["stopped", "stopping", "shutting-down"].includes(detail.state) ? "medium" : "low";
  } else if (envelope.source === "aws.guardduty") {
    const score = Number(detail.severity || 0);
    severity = score >= 7 ? "critical" : score >= 4 ? "high" : "medium";
  } else if (envelope.source === "aws.securityhub") {
    const label = String(detail.findings?.[0]?.Severity?.Label || "").toLowerCase();
    severity = label === "critical" ? "critical" : label === "high" ? "high" : label === "medium" ? "medium" : "low";
  }
  const finding = detail.findings?.[0] || {};
  body = {
    ...detail,
    eventId: envelope.id,
    eventType,
    occurredAt: envelope.time,
    sourceType: envelope.source,
    region: envelope.region,
    accountId: envelope.account,
    resourceId: detail["instance-id"] || alarmName || detail.functionName || detail.resource?.resourceId || finding.Resources?.[0]?.Id || "",
    resourceState: state || "",
    service: envelope.source === "aws.guardduty" ? "AWS/GuardDuty" : envelope.source === "aws.securityhub" ? "AWS/SecurityHub" : alarmName.toLowerCase().includes("lambda") ? "AWS/Lambda" : alarmName.toLowerCase().includes("server") ? "AWS/EC2" : "AWS",
    severity,
    title: alarmName || detail["instance-id"] || finding.Title || detail.title || eventType,
    summary: detail.state && typeof detail.state === "object" ? (detail.state.reason || detail.state.value || "CloudWatch alarm state changed") : (finding.Description || detail.description || detail.message || detail.reason || String(state || "AWS event received"))
  };
}
