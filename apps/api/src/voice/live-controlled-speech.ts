import { randomUUID } from "node:crypto";
import { decodePcmu, pcmuHasSpeech } from "./pcmu-activity";

export const spokenText = (text: string) => text.normalize("NFKC").toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]/gu, "");

/** Stream original PCMU for low latency. This is a transition gate, not a pre-playback filter.
 * A quiet interval alone cannot complete speech: the entire expected native transcript is
 * also required. Only the matching, uncleared Twilio mark establishes playback completion.
 * Before consent the provider has no task context; mismatch clears playback and fails closed.
 */
export class LiveControlledSpeech {
  readonly mark = `live-speech:${randomUUID()}`;
  #bytes = 0;
  #text = "";
  #sealed = false;
  #cancelled = false;
  #queueEnd = 0;
  readonly #audioLimit: number;
  #quiet: ReturnType<typeof setTimeout> | null = null;
  #deadline: ReturnType<typeof setTimeout>;

  constructor(readonly text: string, private readonly release: (audio: string[], mark: string | null) => void,
    private readonly played: () => void, private readonly fail: () => void) {
    const durationMs = Math.min(60_000, Math.max(25_000, text.length * 100));
    this.#audioLimit = durationMs * 8;
    this.#deadline = setTimeout(() => this.#abort(), durationMs);
    this.#deadline.unref?.();
  }

  audio(payload: string) {
    if (this.#cancelled || this.#sealed) return;
    const bytes = decodePcmu(payload);
    if (!bytes || (this.#bytes += bytes.length) > this.#audioLimit) { this.#abort(); return; }
    this.#queueEnd = Math.max(Date.now(), this.#queueEnd) + bytes.length / 8;
    this.release([payload], null);
    if (pcmuHasSpeech(bytes) || !this.#quiet) this.#candidate();
  }
  transcript(text: string) {
    if (this.#cancelled || this.#sealed) return;
    this.#text += text;
    if (this.#text.length > 8_000) { this.#abort(); return; }
    const received = spokenText(this.#text), expected = spokenText(this.text);
    if (!expected.startsWith(received)) { this.#abort(); return; }
    this.#candidate();
  }
  acknowledge(mark: string) {
    if (this.#cancelled || !this.#sealed || mark !== this.mark) return false;
    this.cancel();
    this.played();
    return true;
  }
  cancel() {
    this.#cancelled = true;
    clearTimeout(this.#deadline);
    if (this.#quiet) clearTimeout(this.#quiet);
  }
  #candidate() {
    if (this.#quiet) clearTimeout(this.#quiet);
    if (!this.#bytes || spokenText(this.#text) !== spokenText(this.text)) return;
    this.#quiet = setTimeout(() => {
      if (this.#cancelled || this.#sealed) return;
      this.#sealed = true;
      clearTimeout(this.#deadline);
      this.#deadline = setTimeout(() => this.#abort(), Math.max(0, this.#queueEnd - Date.now()) + 3_000);
      this.#deadline.unref?.();
      this.release([], this.mark);
    }, 500);
    this.#quiet.unref?.();
  }
  #abort() {
    if (this.#cancelled) return;
    this.cancel();
    this.fail();
  }
}
