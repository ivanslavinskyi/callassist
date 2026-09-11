import type { CallLocale } from "@callassist/contracts";

export const endCallReasons = ["objective_resolved", "recipient_requested_end", "cannot_proceed", "voicemail"] as const;
export type EndCallReason = typeof endCallReasons[number];
export type HangupTrigger = "playback_complete" | "generation_timeout" | "playback_timeout" | "response_failed" | "transport_closed";

export const endCallTool = {
  type: "function",
  name: "end_call",
  description: "Finish this call when the approved objective is resolved, the recipient declines or asks to end, or an approved stop condition applies. Call silently BEFORE saying goodbye; the farewell follows automatically. Never explain the tool or disconnection process. Never call for a pause, hold/transfer, an unanswered question, a quoted goodbye or an intermediate thank-you.",
  parameters: {
    type: "object",
    properties: { reason: { type: "string", enum: endCallReasons } },
    required: ["reason"],
    additionalProperties: false
  }
} as const;

export function parseEndCallReason(argumentsJson: unknown): EndCallReason | null {
  if (typeof argumentsJson !== "string" || argumentsJson.length > 256) return null;
  try {
    const value: unknown = JSON.parse(argumentsJson);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const fields = value as Record<string, unknown>;
    return Object.keys(fields).length === 1 && endCallReasons.includes(fields.reason as EndCallReason)
      ? fields.reason as EndCallReason : null;
  } catch { return null; }
}

const farewells: Record<CallLocale, string> = {
  "de-CH": "Vielen Dank für Ihre Zeit. Auf Wiederhören.",
  "de-DE": "Vielen Dank für Ihre Zeit. Auf Wiederhören.",
  "fr-CH": "Merci pour votre temps. Au revoir.",
  "it-CH": "Grazie per il suo tempo. Arrivederci.",
  "en-GB": "Thank you for your time. Goodbye.",
  "en-US": "Thank you for your time. Goodbye.",
  "ru-RU": "Спасибо за ваше время. До свидания."
};

export function farewellInstructions(locale: CallLocale, allowLanguageSwitch: boolean) {
  return allowLanguageSwitch
    ? `Say only a brief equivalent of "Thank you for your time. Goodbye." in the language currently being used with the recipient, within the approved language policy. Do not add a question, a promise or any new facts. Do not call tools.`
    : `Say exactly this farewell and nothing else: "${farewells[locale]}". Do not add a question, a promise or any new facts. Do not call tools.`;
}

/** Owns the farewell deadline and playback generation; cleared marks can never hang up. */
export class AgentHangup {
  state: "active" | "farewell_pending" | "farewell_playing" | "terminating" | "closed" = "active";
  generation = 0;
  reason: EndCallReason | null = null;
  responseId: string | null = null;
  mark: string | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #deadline = 0;
  #audioMs = 0;
  #queueEnd = 0;
  readonly #seenCalls = new Set<string>();

  constructor(
    readonly attemptId: string,
    private readonly terminate: (reason: EndCallReason, trigger: HangupTrigger, generation: number) => void
  ) {}

  get pending() { return this.state === "farewell_pending" || this.state === "farewell_playing"; }
  get queuedAudioMs() { return Math.max(0, this.#queueEnd - Date.now()); }

  request(callId: string, reason: EndCallReason) {
    if (this.state !== "active" || this.#seenCalls.has(callId)) return false;
    this.#seenCalls.add(callId);
    this.generation++;
    this.reason = reason;
    this.responseId = null;
    this.mark = null;
    this.#audioMs = 0;
    this.#deadline = Date.now() + 15_000;
    this.state = "farewell_pending";
    this.#schedule(10_000, "generation_timeout");
    return true;
  }

  bindResponse(responseId: string, generation: number) {
    if (this.state !== "farewell_pending" || generation !== this.generation || this.responseId) return false;
    this.responseId = responseId;
    return true;
  }

  // PCMU is 8,000 bytes/sec. Track all output, including any queued summary.
  audio(bytes: number, responseId: string | undefined) {
    const duration = bytes / 8;
    this.#queueEnd = Math.max(Date.now(), this.#queueEnd) + duration;
    if (this.pending && responseId === this.responseId) this.#audioMs += duration;
  }

  responseDone(responseId: string, status: string | undefined) {
    if (!this.pending || responseId !== this.responseId) return null;
    if (status !== "completed" || this.#audioMs === 0) {
      this.finish("response_failed");
      return null;
    }
    this.state = "farewell_playing";
    this.mark = `farewell:${this.attemptId}:${this.generation}:${responseId}`;
    this.#schedule(Math.min(this.#deadline - Date.now(), Math.max(0, this.#queueEnd - Date.now()) + 2_000), "playback_timeout");
    return this.mark;
  }

  acknowledge(mark: string) {
    if (this.state !== "farewell_playing" || mark !== this.mark) return false;
    this.finish("playback_complete");
    return true;
  }

  interrupt() {
    if (!this.pending) return false;
    this.#clearTimer();
    this.mark = null;
    this.responseId = null;
    this.state = "active";
    this.clearAudio();
    return true;
  }

  clearAudio() { this.#queueEnd = 0; }

  finish(trigger: HangupTrigger) {
    if (!this.pending || !this.reason) return;
    this.#clearTimer();
    this.mark = null;
    this.state = "terminating";
    this.terminate(this.reason, trigger, this.generation);
  }

  close() {
    this.#clearTimer();
    this.mark = null;
    this.state = "closed";
  }

  #schedule(ms: number, trigger: HangupTrigger) {
    this.#clearTimer();
    this.#timer = setTimeout(() => this.finish(trigger), Math.max(0, ms));
    this.#timer.unref?.();
  }
  #clearTimer() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}
