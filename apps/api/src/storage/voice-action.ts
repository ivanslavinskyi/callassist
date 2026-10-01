import type { AppointmentProposal } from "../realtime/appointment-authorization";

export interface VoiceActionInput {
  callBriefId: string;
  callAttemptId: string;
  snapshotHash: string;
  proposal: AppointmentProposal;
  content: string;
  evidence: string[];
  observations?: Array<{ id: string; text: string }>;
  delivery?: { kind: "request" | "status_check"; status: "not_sent" | "unacknowledged" | "played"; attempt: number };
}
export interface VoiceActionRecord extends VoiceActionInput {
  id: string;
  version: number;
  state: "sending" | "delivered" | "uncertain" | "confirmed";
}
export type VoiceActionTransition = { id: string; version: number; state: "sending" | "delivered" | "uncertain" | "confirmed"; evidence: string[]; observations?: VoiceActionInput["observations"]; delivery?: VoiceActionInput["delivery"] };
export function voiceActionTransitionAllowed(from: VoiceActionRecord["state"], to: VoiceActionTransition["state"],
  previous?: VoiceActionInput["delivery"], next?: VoiceActionInput["delivery"]) {
  if (from === "uncertain" && to === "sending") {
    return !!next && next.status === "not_sent" && next.attempt === (previous?.attempt ?? 1) + 1 && next.attempt <= 3 &&
      (next.kind === "status_check" || previous?.kind === "request" && previous.status === "not_sent" && next.attempt <= 2);
  }
  if (previous && next && (previous.kind !== next.kind || previous.attempt !== next.attempt)) return false;
  if (previous && to === "delivered" && next?.status !== "played") return false;
  if (previous && to === "confirmed" && previous.status !== "played") return false;
  if (next && to === "uncertain" && next.status === "played") return false;
  return from === "sending" && (to === "delivered" || to === "uncertain") || from === "delivered" && to === "confirmed";
}
