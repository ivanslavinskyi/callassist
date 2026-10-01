import WebSocket, { type RawData } from "ws";
import { OpenAIRealtimeBridge, type OpenAIRealtimeBridgeOptions } from "../realtime/openai-realtime-bridge";
import type { VoiceRuntime } from "./voice-runtime";
import { object } from "./live-usage";
import { UnifiedLiveCall } from "./unified-live-call";

import { OpenAILiveConversation } from "./live-conversation";
export { OpenAILiveConversation, buildLiveInstructions } from "./live-conversation";


export interface LiveLifecycle {
  transcriptCaptureComplete?(): boolean;
  startup(): { instructions: string; input: unknown[] };
  backendFailed?(current?: () => boolean, code?: string): void;
  backendProgress?(): void;
  nativeOutputDiscarded?(): void;
  consentDecisionUnavailable?(reason?: "provider_failure" | "contract_violation"): void;
  decisionReady?(): boolean;
  taskDecisionContext?(): { closing: boolean; waitingExpired: boolean; appointment?: unknown };
  closingBackendCompleted?(): void;
  ready(): void;
  activity(event: "started" | "stopped" | null, voicedMs?: number): void;
  audio(payload: string): void;
  transcript(role: "recipient" | "assistant", text: string, startMs: number, endMs: number, persist: () => void): boolean;
  tool(call: { name: string; arguments: string }, current: () => boolean): Promise<Record<string, unknown>>;
}

export type OpenAILiveBridgeOptions = OpenAIRealtimeBridgeOptions & {
  liveModel?: string;
  delegationModel?: string;
  speechModel?: string;
  createLiveSocket?: (url: string, apiKey: string) => WebSocket;
  liveStartupTimeoutMs?: number;
  semanticFetch?: typeof fetch;
  speechFetch?: typeof fetch;
};

/** Native Live lifecycle by default; explicit legacy fallback retains the hybrid pilot. */
export class OpenAILiveBridge implements VoiceRuntime {
  readonly #gate: OpenAIRealtimeBridge | null;
  readonly #attached = new Map<string, UnifiedLiveCall>();
  readonly #prepared = new Map<string, { call: UnifiedLiveCall; timer: ReturnType<typeof setTimeout> }>();
  prepareCall: NonNullable<VoiceRuntime["prepareCall"]> = async binding => {
    if (this.#gate || this.#attached.has(binding.callAttemptId) || this.#prepared.has(binding.callAttemptId) || this.#prepared.size >= 64) return;
    const call = new UnifiedLiveCall(this.options);
    const timer = setTimeout(() => this.releasePrepared(binding.callAttemptId), 45_000);
    timer.unref?.();
    this.#prepared.set(binding.callAttemptId, { call, timer });
    await call.prepare(binding);
    if (call.closed) this.releasePrepared(binding.callAttemptId);
  };
  releasePrepared(attemptId: string) {
    const entry = this.#prepared.get(attemptId);
    if (entry) { this.#prepared.delete(attemptId); clearTimeout(entry.timer); entry.call.dispose(); }
  }
  close() {
    for (const id of this.#prepared.keys()) this.releasePrepared(id);
    for (const call of this.#attached.values()) call.dispose();
    this.#attached.clear();
  }
  constructor(private readonly options: OpenAILiveBridgeOptions) {
    // Explicit legacy opt-in only. Production live/fallback=false uses one Live session.
    this.#gate = options.conversationFallback ? new OpenAIRealtimeBridge({ ...options,
      createConversation: context => new OpenAILiveConversation(options, context) }) : null;
  }
  handleTwilioSocket(socket: WebSocket) {
    if (this.#gate) this.#gate.handleTwilioSocket(socket);
    else {
      socket.on("error", () => socket.close());
      // Select only after validating the signed attempt binding. Never let a stale
      // or forged socket consume another attempt's prepared provider session.
      const timeout = setTimeout(() => socket.close(), 10_000);
      timeout.unref?.();
      const select = (data: RawData) => {
        let event: Record<string, unknown>;
        try { event = object(JSON.parse(data.toString())); } catch { socket.close(); return; }
        if (event.event === "connected") return;
        socket.off("message", select); clearTimeout(timeout);
        const p = object(object(event.start).customParameters);
        const binding = { callBriefId: p.callBriefId, callAttemptId: p.callAttemptId, compilationSnapshotHash: p.compilationSnapshotHash };
        if (event.event !== "start" || typeof p.callBriefId !== "string" || typeof p.callAttemptId !== "string" ||
            typeof p.compilationSnapshotHash !== "string" || typeof p.streamToken !== "string" ||
            !this.options.validateStreamToken(binding as { callBriefId: string; callAttemptId: string; compilationSnapshotHash: string }, p.streamToken)) { socket.close(); return; }
        if (this.#attached.has(p.callAttemptId)) { socket.close(); return; }
        const entry = this.#prepared.get(p.callAttemptId);
        if (entry) { this.#prepared.delete(p.callAttemptId); clearTimeout(entry.timer); }
        const call = entry?.call ?? new UnifiedLiveCall(this.options);
        const attemptId = p.callAttemptId;
        this.#attached.set(attemptId, call);
        socket.once("close", () => { if (this.#attached.get(attemptId) === call) this.#attached.delete(attemptId); });
        call.attach(socket, data);
      };
      socket.on("message", select);
      socket.once("close", () => clearTimeout(timeout));
    }
  }
}
