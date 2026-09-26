import type { CallBriefStatus, CallLifecycle } from "@callassist/contracts";

export type CallConnectionStatus = "connecting" | "connected" | "reconnecting";
export type CallActivityPhase = "checking" | "consent" | "machine" | "starting" | "dialing" | "connected" | "approval" | "reconnecting";

/** Phone state comes from the call snapshot, never from the SSE connection alone. */
export function callActivityPhase(status: CallBriefStatus, starting: boolean, connection: CallConnectionStatus, lifecycle?: CallLifecycle): CallActivityPhase | null {
  if (["completed", "stopped", "failed"].includes(status)) return null;
  const active = ["dialing", "in_progress", "awaiting_approval"].includes(status);
  if (!active) return starting ? "starting" : null;
  if (connection !== "connected") return "reconnecting";
  if (status === "in_progress" && lifecycle?.answering?.phase === "pending") return "checking";
  if (status === "in_progress" && lifecycle?.answering?.decision && lifecycle.answering.decision !== "consent") return "machine";
  if (status === "in_progress" && lifecycle?.answering?.decision === "consent" && lifecycle.consent !== "granted") return "consent";
  if (status === "awaiting_approval") return "approval";
  return status === "dialing" ? "dialing" : "connected";
}
