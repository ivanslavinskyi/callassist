import { type TerminalDecision } from "@callassist/contracts";
import { endCallReasons, type EndCallReason } from "../realtime/agent-hangup";
import type { VoiceConversationContext } from "./voice-runtime";
import type { OpenAILiveBridgeOptions } from "./openai-live-bridge";
import { LiveNativeClosing } from "./live-native-closing";
import { pcmuHasSpeech } from "./pcmu-activity";

/** Post-consent policy only. Admission, consent, recording and media transport
 * stay in the shared host. No question scheduler or application speech renderer. */
export class LiveNativeCall {
  readonly closing: LiveNativeClosing;
  #started = false;
  #closed = false;
  #speaking = false;
  #revision = 0;
  #turn = 0;
  #fragments: Array<{ text: string; start: number; end: number }> = [];
  #observations: Array<{ id: string; text: string }> = [];
  #settle: ReturnType<typeof setTimeout> | null = null;
  #idle: ReturnType<typeof setTimeout> | null = null;
  #maximum: ReturnType<typeof setTimeout> | null = null;
  #decision: TerminalDecision | null = null;
  #inputRevision = 0;
  constructor(private readonly context: VoiceConversationContext, private readonly options: OpenAILiveBridgeOptions,
    private readonly ports: { mark(name: string): void; hangup(reason: EndCallReason): void; fail(code: string): void }) {
    this.closing = new LiveNativeClosing({ mark: ports.mark, failed: code => ports.fail(code),
      observe: (phase, revision, mark) => this.options.logger?.info({ callAttemptId: context.attemptId,
        runtime: "live_native_v1", phase, revision, mark, at: Date.now() }, "Native closing playback"), drained: () => {
      if (!this.#closed && !this.#speaking && !this.#fragments.length && this.#decision)
        ports.hangup(this.#decision.reason);
    } });
  }
  start() {
    this.#started = true; this.#touch();
    this.#maximum = setTimeout(() => this.ports.fail("LIVE_NATIVE_DURATION_LIMIT"), 10 * 60_000);
    this.#maximum.unref?.();
  }
  get active() { return this.#started && !this.#closed; }
  #touch() {
    if (this.#idle) clearTimeout(this.#idle);
    this.#idle = setTimeout(() => this.ports.fail("LIVE_NATIVE_IDLE_TIMEOUT"), 90_000);
    this.#idle.unref?.();
  }
  audio(payload: string) {
    if (!this.active) return;
    if (pcmuHasSpeech(Buffer.from(payload, "base64"))) this.#touch();
    this.closing.audio(payload);
  }
  transcript(role: "recipient" | "assistant", text: string, start: number, end: number) {
    if (!this.active) return false;
    if (!text.trim()) return true;
    this.#touch();
    if (role === "assistant") { this.closing.caption(text); return true; }
    this.#inputRevision++;
    this.#decision = null; this.closing.cancel();
    this.#fragments.push({ text, start, end });
    if (this.#fragments.reduce((n, f) => n + f.text.length, 0) > 8_000) {
      this.ports.fail("LIVE_NATIVE_TRANSCRIPT_LIMIT"); return false;
    }
    this.#settleInput(); return true;
  }
  activity(event: "started" | "stopped" | null) {
    if (!this.active || !event) return;
    this.#speaking = event === "started";
    this.closing.activity(event);
    if (this.#settle) clearTimeout(this.#settle);
    this.#settle = null;
    if (!this.#speaking) this.#settleInput();
  }
  keypad(digit: string) {
    if (["1", "2"].includes(digit)) this.transcript("recipient",
      `[Key ${digit}: ${digit === "1" ? "Yes" : "No"} to the preceding yes/no question only]`, Date.now(), Date.now());
  }
  #settleInput() {
    if (this.#settle) clearTimeout(this.#settle);
    this.#settle = null;
    if (this.#speaking || !this.#fragments.length) return;
    this.#settle = setTimeout(() => {
      this.#settle = null;
      const text = this.#fragments.sort((a, b) => a.start - b.start || a.end - b.end).map(f => f.text).join("");
      this.#fragments = [];
      this.#observations.push({ id: `turn-${++this.#turn}`, text });
      this.#observations = this.#observations.slice(-8);
    }, 600);
    this.#settle.unref?.();
  }
  async tool(call: { name: string; arguments: string }, current: () => boolean): Promise<Record<string, unknown>> {
    const reject = (reason: string) => ({ ok: false, reason });
    if (call.name !== "end_call" || !this.options.agentHangupEnabled) return reject("unsupported_tool");
    const fresh = () => this.active && current() && !this.#speaking && !this.#fragments.length;
    if (!fresh()) return reject("stale_or_unauthorized_request");
    let value: Record<string, unknown>;
    try { value = JSON.parse(call.arguments); } catch { return reject("invalid_arguments"); }
    if (!value || typeof value !== "object" || Object.keys(value).sort().join() !== "reason,resultSummary" ||
        !endCallReasons.includes(value.reason as EndCallReason) || value.reason === "voicemail" ||
        typeof value.resultSummary !== "string" || value.resultSummary.trim().length < 2 || value.resultSummary.length > 400)
      return reject("invalid_closing_request");
    if (!this.#observations.length) return reject("recipient_evidence_required");
    if (this.#decision && this.closing.active) return { ok: true, state: "closing_authorized", reason: this.#decision.reason };
    const inputRevision = this.#inputRevision;
    const decision: TerminalDecision = { callBriefId: this.context.brief.id, callAttemptId: this.context.attemptId,
      snapshotHash: this.context.snapshot.compilationSnapshotHash, revision: ++this.#revision,
      reason: value.reason as EndCallReason, summary: value.resultSummary.trim(),
      evidence: this.#observations.map(t => t.id), observations: [...this.#observations],
      actionState: null, locale: this.context.snapshot.plan.callLocale };
    // Durable decision evidence precedes authorization. This is a decision
    // revision, not proof of delivered speech or a successfully disconnected call.
    await this.options.service.repository.recordTerminalDecision(decision);
    if (!fresh() || inputRevision !== this.#inputRevision) return reject("stale_request");
    this.#decision = decision; this.closing.request();
    this.context.telemetry(`live:native:closing:${decision.revision}`, { name: "conversation.task", metadata: {
      runtimeVersion: "live-native-v1", phase: "close", revision: decision.revision, cause: "native_closing_requested" } });
    return { ok: true, state: "closing_authorized", actionCompleted: false, reason: decision.reason,
      instruction: "Finish with a brief natural farewell now. Do not repeat a recap already spoken. New recipient information cancels this closing; continue naturally and request a fresh end_call when ready." };
  }
  cleared() { this.#decision = null; this.closing.cancel(); }
  close() {
    this.#closed = true; this.closing.cancel();
    for (const timer of [this.#settle, this.#idle, this.#maximum]) if (timer) clearTimeout(timer);
    this.#fragments = []; this.#observations = [];
  }
}
