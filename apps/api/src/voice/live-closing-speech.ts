import { randomUUID } from "node:crypto";
import { decodePcmu, pcmuHasSpeech } from "./pcmu-activity";

/** Tracks the final Live utterance and Twilio playback without re-classifying its meaning.
 * Backend completion authorizes closing content; an output quiet interval identifies the
 * end of this deliberately short turn, and only the matching Twilio mark proves playback. */
export class LiveClosingSpeech {
  #text = "";
  #bytes = 0;
  #voiced = false;
  #queueEnd = 0;
  #mark: string | null = null;
  #cancelled = false;
  #ready = false;
  #quiet: ReturnType<typeof setTimeout> | null = null;
  #progress: ReturnType<typeof setTimeout> | null = null;
  #playback: ReturnType<typeof setTimeout> | null = null;
  readonly #deadline: ReturnType<typeof setTimeout>;

  constructor(private readonly release: (payload: string) => void,
    private readonly mark: (name: string) => void, private readonly played: () => void,
    private readonly fail: (reason: string) => void) {
    this.#deadline = setTimeout(() => this.#abort("LIVE_CLOSING_DEADLINE"), 20_000);
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
    if (!bytes || (this.#bytes += bytes.length) > 160_000) { this.#abort("LIVE_CLOSING_AUDIO_LIMIT"); return; }
    this.#queueEnd = Math.max(Date.now(), this.#queueEnd) + bytes.length / 8;
    this.release(payload);
    if (pcmuHasSpeech(bytes)) { this.#voiced = true; this.#changed(); }
  }
  transcript(text: string) {
    if (this.#cancelled) return;
    this.#text += text;
    if (this.#text.length > 2_000) { this.#abort("LIVE_CLOSING_TEXT_LIMIT"); return; }
    if (text.trim()) this.#changed();
  }
  acknowledge(name: string) {
    if (this.#cancelled || !this.#mark || name !== this.#mark) return false;
    this.cancel(); this.played(); return true;
  }
  playbackCleared() {
    if (!this.#cancelled) this.#abort("LIVE_CLOSING_PLAYBACK_CLEARED");
  }
  cancel() {
    this.#cancelled = true;
    this.#mark = null;
    clearTimeout(this.#deadline);
    if (this.#quiet) clearTimeout(this.#quiet);
    if (this.#progress) clearTimeout(this.#progress);
    if (this.#playback) clearTimeout(this.#playback);
  }
  #changed() {
    this.#mark = null;
    if (this.#quiet) clearTimeout(this.#quiet);
    if (this.#playback) clearTimeout(this.#playback);
    if (!this.#ready || this.#cancelled) return;
    if (this.#progress) clearTimeout(this.#progress);
    this.#progress = setTimeout(() => this.#abort("LIVE_CLOSING_NO_PROGRESS"), 3_000);
    this.#progress.unref?.();
    if (!this.#voiced || !this.#text.trim()) return;
    this.#quiet = setTimeout(() => this.#complete(), 1_000);
    this.#quiet.unref?.();
  }
  #complete() {
    if (this.#cancelled || !this.#ready || !this.#voiced || !this.#text.trim()) return;
    if (this.#progress) clearTimeout(this.#progress);
    this.#mark = `live-closing:${randomUUID()}`;
    this.#playback = setTimeout(() => this.#abort("LIVE_CLOSING_PLAYBACK_TIMEOUT"),
      Math.max(0, this.#queueEnd - Date.now()) + 3_000);
    this.#playback.unref?.();
    this.mark(this.#mark);
  }
  #abort(reason: string) { if (!this.#cancelled) { this.cancel(); this.fail(reason); } }
}
