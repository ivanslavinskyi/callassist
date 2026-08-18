import type { CallBriefStatus } from "@callassist/contracts";

export const terminalCallStatuses = new Set<CallBriefStatus>([
  "completed",
  "stopped",
  "failed"
]);

export function isTerminalCallStatus(status: CallBriefStatus) {
  return terminalCallStatuses.has(status);
}
