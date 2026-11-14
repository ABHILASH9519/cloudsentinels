// Events arrive through the dedicated AWS EventBridge -> SQS -> local poller bridge.
// This node makes the AWS connector explicit in the n8n execution path while
// preserving the normalized event envelope used by the shared incident policy.
return $input.all().map(({ json: e }) => {
  const isAws = String(e.sourceType || "").startsWith("aws.") ||
    String(e.service || "").startsWith("AWS/");
  if (!isAws) return { json: { ...e, ingestConnector: e.ingestConnector || "cloudsentinels-agent-or-webhook" } };
  return { json: {
    ...e,
    ingestConnector: "aws-eventbridge-sqs",
    aws: {
      provider: "AWS",
      eventSource: e.sourceType || "unknown",
      eventType: e.eventType || "unknown",
      accountId: e.accountId || null,
      region: e.region || null,
      resourceId: e.resourceId || null,
      resourceState: e.resourceState || null,
      receivedThrough: "dedicated-cloudsentinels-n8n-sqs-queue"
    }
  }};
});
