import type { AppointmentProposal } from "../realtime/appointment-authorization";

export interface VoiceActionInput {
  callBriefId: string;
  callAttemptId: string;
  snapshotHash: string;
  proposal: AppointmentProposal;
  content: string;
  evidence: string[];
  observations?: Array<{ id: string; text: string }>;
}
export interface VoiceActionRecord extends VoiceActionInput {
  id: string;
  version: number;
  state: "sending" | "delivered" | "uncertain" | "confirmed";
}
export type VoiceActionTransition = { id: string; version: number; state: "delivered" | "uncertain" | "confirmed"; evidence: string[]; observations?: VoiceActionInput["observations"] };
export function voiceActionTransitionAllowed(from: VoiceActionRecord["state"], to: VoiceActionTransition["state"]) {
  return from === "sending" && (to === "delivered" || to === "uncertain") || from === "delivered" && to === "confirmed";
}
