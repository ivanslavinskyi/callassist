import { randomUUID } from "node:crypto";
import { decodePcmu, pcmuHasSpeech } from "./pcmu-activity";
import type { SemanticDecision } from "./live-semantic-gate";

const INCOMPLETE_OUTPUT_IDLE_MS = 1_200;

export const spokenText = (text: string) => text.normalize("NFKC").toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]/gu, "");

/** Stream original PCMU for low latency. This is a transition gate, not a pre-playback filter.
 * A quiet interval alone cannot complete speech: the entire expected native transcript is
 * also required (exact match or verified semantic equivalence). Only the matching,
 * uncleared Twilio mark establishes playback completion. Partial transcript spelling
 * is not a safety violation. Incomplete meaning never authorizes a transition.
 */
export class LiveControlledSpeech {
  readonly mark = `live-speech:${randomUUID()}`;
  #bytes = 0;
  #text = "";
  #sealed = false;
  #cancelled = false;
  #queueEnd = 0;
  #verified = false;
  #revision = 0;
  #verification: AbortController | null = null;
  #verifications = 0;
  #buffer: string[] = [];
  readonly #audioLimit: number;
  #quiet: ReturnType<typeof setTimeout> | null = null;
  #incomplete: ReturnType<typeof setTimeout> | null = null;
  #incompleteRevision: number | null = null;
  #recipientSpeaking = false;
  #deadline: ReturnType<typeof setTimeout>;

  constructor(readonly text: string, private readonly release: (audio: string[], mark: string | null) => void,
    private readonly played: () => void, private readonly fail: (reason: string) => void,
    private readonly verify: (text: string, signal: AbortSignal) => Promise<SemanticDecision>,
    private readonly buffered = false,
    private readonly limits?: { deadlineMs: number; exactOnly: boolean },
    private readonly requireWholeUtterance = false) {
    const durationMs = limits?.deadlineMs ?? Math.min(60_000, Math.max(25_000, text.length * 100));
    this.#audioLimit = durationMs * 8;
    this.#deadline = setTimeout(() => this.#abort("LIVE_SPEECH_DEADLINE"), durationMs);
    this.#deadline.unref?.();
  }

  audio(payload: string) {
    if (this.#cancelled || this.#sealed) return;
    const bytes = decodePcmu(payload);
    if (!bytes || (this.#bytes += bytes.length) > this.#audioLimit) { this.#abort("LIVE_SPEECH_AUDIO_LIMIT"); return; }
    this.#queueEnd = Math.max(Date.now(), this.#queueEnd) + bytes.length / 8;
    if (this.buffered) this.#buffer.push(payload);
    else this.release([payload], null);
    if (pcmuHasSpeech(bytes)) this.#candidate();
    else if (this.#incompleteRevision !== null) this.#scheduleIncomplete(this.#incompleteRevision);
    else if (!this.#quiet) this.#candidate();
  }
  transcript(text: string) {
    if (this.#cancelled || this.#sealed) return false;
    this.#text += text;
    if (this.#text.length > 8_000) { this.#abort("LIVE_SPEECH_TEXT_LIMIT"); return false; }
    this.#verified = false;
    this.#candidate();
    return true;
  }
  get textComplete() {
    const received = spokenText(this.#text), expected = spokenText(this.text);
    // Streaming transition speech can start while the previous utterance is still
    // arriving. Its complete required suffix establishes the transition content;
    // it does not certify every earlier word. Buffered commitments must match all
    // text because none of their audio has yet been authorized for playback.
    return this.#verified || received === expected ||
      (!this.buffered && !this.requireWholeUtterance && received.endsWith(expected));
  }
  acknowledge(mark: string) {
    if (this.#cancelled || !this.#sealed || mark !== this.mark) return false;
    this.cancel();
    this.played();
    return true;
  }
  inputActivity(event: "started" | "stopped") {
    if (this.#cancelled || this.#sealed) return;
    this.#recipientSpeaking = event === "started";
    if (this.#recipientSpeaking) {
      if (this.#incomplete) clearTimeout(this.#incomplete);
      this.#incomplete = null;
    } else if (this.#incompleteRevision !== null) this.#scheduleIncomplete(this.#incompleteRevision);
  }
  cancel() {
    this.#cancelled = true;
    this.#buffer = [];
    this.#verification?.abort(); this.#verification = null;
    clearTimeout(this.#deadline);
    if (this.#quiet) clearTimeout(this.#quiet);
    if (this.#incomplete) clearTimeout(this.#incomplete);
  }
  #candidate() {
    const revision = ++this.#revision;
    this.#verification?.abort(); this.#verification = null;
    if (this.#quiet) clearTimeout(this.#quiet);
    this.#quiet = null;
    if (this.#incomplete) clearTimeout(this.#incomplete);
    this.#incomplete = null;
    this.#incompleteRevision = null;
    if (!this.#bytes || !spokenText(this.#text)) return;
    // An exact but unfinished prefix needs more transcript, not another model.
    // If neither audio nor text resumes, recover without waiting for the global
    // speech deadline; Live does not expose an output-audio-completed event.
    if (!this.textComplete && spokenText(this.text).startsWith(spokenText(this.#text))) {
      this.#markIncomplete(revision);
      return;
    }
    this.#quiet = setTimeout(() => {
      if (this.#cancelled || this.#sealed) return;
      if (this.textComplete) { this.#seal(); return; }
      if (this.limits?.exactOnly) { this.#abort("LIVE_SPEECH_MEANING_UNVERIFIED"); return; }
      if (this.#verifications++ >= 8) { this.#abort("LIVE_SPEECH_VERIFICATION_LIMIT"); return; }
      const controller = new AbortController(); this.#verification = controller;
      void this.verify(this.#text, controller.signal).then(decision => {
        if (controller.signal.aborted || revision !== this.#revision || this.#cancelled || this.#sealed) return;
        if (decision === "equivalent") { this.#verified = true; this.#seal(); }
        else if (decision !== "incomplete") this.#abort("LIVE_SPEECH_MEANING_UNVERIFIED");
        else this.#markIncomplete(revision);
      }).catch(() => {
        if (!controller.signal.aborted && revision === this.#revision) this.#abort("LIVE_SPEECH_VERIFICATION_FAILED");
      });
    }, 500);
    this.#quiet.unref?.();
  }
  #markIncomplete(revision: number) {
    if (this.#cancelled || this.#sealed || revision !== this.#revision) return;
    this.#incompleteRevision = revision;
    this.#scheduleIncomplete(revision);
  }
  #scheduleIncomplete(revision: number) {
    if (this.#incomplete) clearTimeout(this.#incomplete);
    this.#incomplete = null;
    if (this.#recipientSpeaking || this.#cancelled || this.#sealed ||
        this.#incompleteRevision !== revision || revision !== this.#revision) return;
    this.#incomplete = setTimeout(() => {
      this.#incomplete = null;
      if (!this.#recipientSpeaking && this.#incompleteRevision === revision && revision === this.#revision)
        this.#abort("LIVE_SPEECH_OUTPUT_STALLED");
    }, INCOMPLETE_OUTPUT_IDLE_MS);
    this.#incomplete.unref?.();
  }
  #seal() {
    this.#sealed = true;
    if (!this.limits) clearTimeout(this.#deadline);
    if (this.buffered) this.#queueEnd = Date.now() + this.#bytes / 8;
    if (!this.limits) {
      this.#deadline = setTimeout(() => this.#abort("LIVE_SPEECH_PLAYBACK_TIMEOUT"), Math.max(0, this.#queueEnd - Date.now()) + 3_000);
      this.#deadline.unref?.();
    }
    const audio = this.#buffer; this.#buffer = [];
    this.release(audio, this.mark);
  }
  playbackCleared() {
    if (!this.#cancelled && this.#sealed) this.#abort("LIVE_SPEECH_PLAYBACK_CLEARED");
  }
  #abort(reason: string) {
    if (this.#cancelled) return;
    this.cancel();
    this.fail(reason);
  }
}
