import type WebSocket from "ws";
import type { ApprovedExecutionSnapshot, CallBrief, CallTelemetryPayload, LiveRuntimeDiagnostic } from "@callassist/contracts";
import type { EndCallReason } from "../realtime/agent-hangup";

/** The HTTP/Twilio boundary is independent of the conversation protocol. */
export interface VoiceRuntime {
  handleTwilioSocket(socket: WebSocket): void;
  prepareCall?(binding: { callBriefId: string; callAttemptId: string; providerCallId: string; compilationSnapshotHash: string }): Promise<void>;
  releasePrepared?(attemptId: string): void;
  close?(): void;
}

/** Attempt-bound application controls; the runtime must gate model context and actions by call phase. */
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
  diagnostic?(diagnostic: LiveRuntimeDiagnostic): void;
  trace?(direction: "in" | "out" | "host", event: Record<string, unknown>): void;
  fail(): void;
}

export interface VoiceConversation {
  start(): Promise<void>;
  inputAudio(payload: string): void;
  keypad(digit: string): void;
  close(): void;
}
