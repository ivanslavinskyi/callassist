import { randomUUID } from "node:crypto";
import { decodePcmu, pcmuHasSpeech } from "./pcmu-activity";
import type { SemanticDecision } from "./live-semantic-gate";

/** Backend completion enables inspection; only an uncleared mark proves playback. */
export class LiveClosingSpeech {
  #text = "";
  #bytes = 0;
  #voiced = false;
  #queueEnd = 0;
  #revision = 0;
  #mark: string | null = null;
  #cancelled = false;
  #ready = false;
  #checks = 0;
  #lastCheckedText = "";
  #request: AbortController | null = null;
  #quiet: ReturnType<typeof setTimeout> | null = null;
  #progress: ReturnType<typeof setTimeout> | null = null;
  #playback: ReturnType<typeof setTimeout> | null = null;
  readonly #deadline: ReturnType<typeof setTimeout>;

  constructor(private readonly release: (payload: string) => void,
    private readonly mark: (name: string) => void, private readonly played: () => void,
    private readonly fail: (reason: string) => void,
    private readonly verify: (text: string, signal: AbortSignal) => Promise<SemanticDecision>) {
    this.#deadline = setTimeout(() => this.#abort("LIVE_CLOSING_DEADLINE"), 30_000);
    this.#deadline.unref?.();
  }
  backendCompleted() {
    if (this.#cancelled || this.#ready) return;
    this.#ready = true;
    this.#changed();
  }
  audio(payload: string) {
    if (this.#cancelled) return;
    const bytes = decodePcmu(payload);
    if (!bytes || (this.#bytes += bytes.length) > 240_000) { this.#abort("LIVE_CLOSING_AUDIO_LIMIT"); return; }
    this.#queueEnd = Math.max(Date.now(), this.#queueEnd) + bytes.length / 8;
    this.release(payload);
    if (pcmuHasSpeech(bytes)) { this.#voiced = true; this.#changed(); }
  }
  transcript(text: string) {
    if (this.#cancelled) return;
    this.#text += text;
    if (this.#text.length > 8_000) { this.#abort("LIVE_CLOSING_TEXT_LIMIT"); return; }
    if (text.trim()) this.#changed();
  }
  acknowledge(name: string) {
    if (this.#cancelled || !this.#mark || name !== this.#mark) return false;
    this.cancel(); this.played(); return true;
  }
  cancel() {
    this.#cancelled = true;
    this.#mark = null;
    this.#request?.abort();
    clearTimeout(this.#deadline);
    if (this.#quiet) clearTimeout(this.#quiet);
    if (this.#progress) clearTimeout(this.#progress);
    if (this.#playback) clearTimeout(this.#playback);
  }
  #noProgress() {
    if (this.#progress) clearTimeout(this.#progress);
    this.#progress = setTimeout(() => this.#abort("LIVE_CLOSING_NO_PROGRESS"), 2_000);
    this.#progress.unref?.();
  }
  #changed() {
    ++this.#revision;
    this.#mark = null;
    this.#request?.abort();
    if (this.#quiet) clearTimeout(this.#quiet);
    if (this.#playback) clearTimeout(this.#playback);
    if (!this.#ready || this.#cancelled) return;
    this.#noProgress();
    this.#schedule();
  }
  #schedule() {
    if (!this.#voiced || !this.#text.trim() || this.#text === this.#lastCheckedText || this.#cancelled) return;
    if (this.#quiet) clearTimeout(this.#quiet);
    this.#quiet = setTimeout(() => { void this.#inspect(); }, 700);
    this.#quiet.unref?.();
  }
  async #inspect() {
    if (this.#cancelled || this.#request) return;
    if (this.#checks++ >= 2) { this.#abort("LIVE_CLOSING_VERIFICATION_LIMIT"); return; }
    if (this.#progress) clearTimeout(this.#progress);
    const revision = this.#revision, request = new AbortController();
    this.#request = request;
    const timeout = setTimeout(() => { request.abort(); this.#abort("LIVE_CLOSING_VERIFICATION_TIMEOUT"); }, 6_000);
    timeout.unref?.();
    try {
      const decision = await this.verify(this.#text, request.signal);
      if (this.#cancelled || request.signal.aborted || revision !== this.#revision) return;
      if (decision === "equivalent") {
        this.#mark = `live-closing:${randomUUID()}`;
        this.#playback = setTimeout(() => this.#abort("LIVE_CLOSING_PLAYBACK_TIMEOUT"), Math.max(0, this.#queueEnd - Date.now()) + 3_000);
        this.#playback.unref?.(); this.mark(this.#mark);
      } else if (decision === "incomplete") { this.#lastCheckedText = this.#text; this.#noProgress(); }
      else this.#abort(decision === "different" ? "LIVE_CLOSING_CONTINUING" : "LIVE_CLOSING_UNCLEAR");
    } catch {
      if (!request.signal.aborted) this.#abort("LIVE_CLOSING_VERIFICATION_FAILED");
    } finally {
      clearTimeout(timeout); this.#request = null;
      if (!this.#cancelled && revision !== this.#revision) this.#schedule();
    }
  }
  #abort(reason: string) { if (!this.#cancelled) { this.cancel(); this.fail(reason); } }
}
