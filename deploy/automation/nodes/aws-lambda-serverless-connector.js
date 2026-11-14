// Explicit AWS Lambda / serverless event adapter.
// Lambda alarm and function events are enriched for the shared remediation policy.
// This node does not invoke Lambda APIs or mutate function configuration.
return $input.all().map(({ json: e }) => {
  const text = [
    e.service, e.title, e.summary, e.eventType, e.resourceKind, e.resourceName,
    e.resourceId, e.functionName, e.alarmName
  ].join(" ").toLowerCase();
  const isLambda = /lambda|serverless/.test(text) ||
    (String(e.sourceType || "").startsWith("aws.") && /function/i.test(String(e.resourceKind || "")));
  if (!isLambda) return { json: e };
  const functionName = e.functionName || e.resourceName ||
    (String(e.resourceId || "").startsWith("arn:") ? e.resourceId.split(":").pop() : e.resourceId) || null;
  return { json: {
    ...e,
    service: "AWS/Lambda",
    sourceType: e.sourceType || "aws.lambda",
    resourceKind: "AWS::Lambda::Function",
    resourceName: functionName || e.resourceName || null,
    functionName,
    ingestConnector: "aws-lambda-cloudwatch-eventbridge",
    serverless: {
      provider: "AWS Lambda",
      functionName,
      region: e.region || null,
      accountId: e.accountId || null,
      alarmName: e.alarmName || e.title || null,
      alarmState: e.resourceState || null,
      diagnostics: ["errors", "throttles", "duration", "concurrency", "logs"],
      mutationEnabled: false,
      approvalRequiredForChanges: true
    }
  }};
});
