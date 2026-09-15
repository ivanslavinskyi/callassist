import type { CallBriefStatus } from "@callassist/contracts";

export type CallConnectionStatus = "connecting" | "connected" | "reconnecting";
export type CallActivityPhase = "starting" | "dialing" | "connected" | "approval" | "reconnecting";

/** Phone state comes from the call snapshot, never from the SSE connection alone. */
export function callActivityPhase(status: CallBriefStatus, starting: boolean, connection: CallConnectionStatus): CallActivityPhase | null {
  if (["completed", "stopped", "failed"].includes(status)) return null;
  const active = ["dialing", "in_progress", "awaiting_approval"].includes(status);
  if (!active) return starting ? "starting" : null;
  if (connection !== "connected") return "reconnecting";
  if (status === "awaiting_approval") return "approval";
  return status === "dialing" ? "dialing" : "connected";
}
