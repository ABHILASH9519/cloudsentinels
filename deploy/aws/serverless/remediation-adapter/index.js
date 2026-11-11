const ALLOWED_ACTIONS = new Set([
  "restart-pod",
  "replace-or-recover-node",
  "scale-workload",
  "diagnose-memory-pressure",
  "rollback-deployment",
  "scale-or-investigate-service",
]);

const requiredFields = [
  "commandId",
  "eventId",
  "action",
  "clusterName",
  "approvedBy",
  "approvedAt",
];

export async function handler(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    return { accepted: false, error: "A JSON command object is required." };
  }
  for (const field of requiredFields) {
    if (typeof command[field] !== "string" || !command[field].trim() || command[field].length > 256) {
      return { accepted: false, error: `Invalid or missing ${field}.` };
    }
  }
  if (!ALLOWED_ACTIONS.has(command.action)) {
    return { accepted: false, error: "Action is not allow-listed." };
  }

  // This adapter deliberately performs no AWS or Kubernetes mutation.
  // commandId is the idempotency key for any future real adapter implementation.
  console.info("Dry-run remediation command accepted", {
    commandId: command.commandId,
    eventId: command.eventId,
    action: command.action,
    clusterName: command.clusterName,
    approvedBy: command.approvedBy,
  });

  return {
    accepted: true,
    executionId: `dry-run-${command.commandId}`,
    recoveryVerified: false,
    mode: "dry-run",
    message: "Command validated. No AWS or Kubernetes resource was changed.",
  };
}
