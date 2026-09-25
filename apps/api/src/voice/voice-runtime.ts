import type WebSocket from "ws";
import type { ApprovedExecutionSnapshot, CallBrief, CallTelemetryPayload } from "@callassist/contracts";
import type { EndCallReason } from "../realtime/agent-hangup";

/** The HTTP/Twilio boundary is independent of the conversation protocol. */
export interface VoiceRuntime {
  handleTwilioSocket(socket: WebSocket): void;
}

/** Entered only after consent, recording startup and the mandatory opening's mark. */
export interface VoiceConversationContext {
  brief: CallBrief;
  snapshot: ApprovedExecutionSnapshot;
  attemptId: string;
  sendAudio(payload: string): void;
  clearPlayback(): void;
  requestFarewell(callId: string, reason: EndCallReason): boolean;
  interruptFarewell(): boolean;
  isClosing(): boolean;
  telemetry(key: string, payload: CallTelemetryPayload): void;
  fail(): void;
}

export interface VoiceConversation {
  start(): Promise<void>;
  inputAudio(payload: string): void;
  keypad(digit: string): void;
  close(): void;
}
