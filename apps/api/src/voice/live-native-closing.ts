import { pcmuHasSpeech } from "./pcmu-activity";

// Closing evidence is about words, not ASR's choice of terminal punctuation.
// Action quotes and identifiers deliberately keep their stricter validation.
export function closingEvidence(text:string){return text.normalize("NFC").replace(/[\p{P}\s]+/gu," ").trim();}

/** Provisional playback drain, NOT an API turn-done detector. Live has no such
 * event. Quiet-tail thresholds need acoustic acceptance before promotion. */
export class LiveNativeClosing {
  #revision = 0;
  #active = false;
  #speaking = false;
  #voiceMs = 0;
  #caption = false;
  #lastActivity = 0;
  #mark: string | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #deadline: ReturnType<typeof setTimeout> | null = null;
  #watermark = 0;
  #recent = { voiceMs: 0, caption: false, at: 0, text: "" };
  constructor(private readonly ports: { mark(name: string): void; drained(): void; failed(code: string): void;
    continuous?: boolean;
    observe?(phase: "mark_sent" | "mark_acknowledged" | "cancelled" | "drained", revision: number, mark: string | null): void }) {}
  get active() { return this.#active; }
  get observedTail() { return this.#recent.text.slice(-1600); }
  observed(quote: string) {
    return !!closingEvidence(quote) && this.#recent.voiceMs >= 100 && closingEvidence(this.#recent.text).includes(closingEvidence(quote));
  }
  request(quote?: string) {
    // In continuous mode the backend must identify the actual concluding
    // episode. Arbitrary previous audio/captions are not closing evidence.
    if (this.ports.continuous && (!quote || !this.observed(quote))) return false;
    const recent = this.#recent, deadline = this.#deadline;
    this.#deadline = null;
    this.cancel(true);
    this.#active = true; this.#lastActivity = Date.now();
    if (this.ports.continuous && recent.at > 0) {
      this.#voiceMs = recent.voiceMs; this.#caption = recent.caption;
      this.#changed();
    }
    this.#deadline = deadline;
    this.boundRecovery();
    return true;
  }
  boundRecovery() {
    if(this.#deadline)return;
    this.#deadline=setTimeout(()=>{
      this.#deadline=null;
      // Never cut off an ongoing recipient turn. The settled review will either
      // resume conversation or bound its empty-response recovery again.
      if(this.#speaking)return;
      this.cancel();this.ports.failed("LIVE_NATIVE_CLOSING_TIMEOUT");
    },30_000);
    this.#deadline.unref?.();
  }
  audio(payload: string) {
    const bytes = Buffer.from(payload, "base64");
    if (!pcmuHasSpeech(bytes)) return;
    if (this.ports.continuous) {
      this.#recent.voiceMs += bytes.length / 8; this.#recent.at = Date.now();
    }
    if (!this.#active) return;
    this.#voiceMs += bytes.length / 8;
    this.#changed();
  }
  caption(text: string) {
    if (this.ports.continuous && text) {
      this.#recent.text = (this.#recent.text + text).slice(-16_000);
      if (text.trim()) { this.#recent.caption = true; this.#recent.at = Date.now(); }
      // A subsequent acknowledgment belongs to the same playback tail. It must
      // drain too, but must not erase the explicitly selected closing episode.
    }
    if (!this.#active || !text.trim()) return;
    this.#caption = true; this.#changed();
  }
  activity(event: "started" | "stopped" | null) {
    if (!event) return;
    this.#speaking = event === "started";
    if (this.#active) this.#changed();
  }
  #changed() {
    this.#lastActivity = Date.now(); this.#mark = null;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#speaking || !this.#caption || this.#voiceMs < 100) return;
    const revision = this.#revision;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (!this.#active || this.#speaking || revision !== this.#revision) return;
      const mark = `live-native-close:${revision}:${++this.#watermark}`;
      this.#mark = mark;
      this.ports.observe?.("mark_sent", revision, mark);
      this.ports.mark(mark);
    }, this.ports.continuous ? 1_000 : 1_500);
    this.#timer.unref?.();
  }
  acknowledge(name: string) {
    if (!name.startsWith("live-native-close:")) return false;
    if (!this.#active || this.#speaking || name !== this.#mark) return true;
    this.ports.observe?.("mark_acknowledged", this.#revision, name);
    this.#mark = null;
    const revision = this.#revision, activity = this.#lastActivity;
    // Give delayed input/captions a final opportunity to revoke the watermark.
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (!this.#active || this.#speaking || revision !== this.#revision || activity !== this.#lastActivity) return;
      this.ports.observe?.("drained", revision, name);
      this.#active = false; this.cancel(); this.ports.drained();
    }, 350);
    this.#timer.unref?.();
    return true;
  }
  // A clear returns pending Twilio marks too. It never establishes playback.
  pause() {
    // Revoke playback permission, retaining the original bounded closing episode.
    const deadline = this.#deadline;
    this.#deadline = null;
    this.cancel(true);
    this.#deadline = deadline;
  }
  cancel(preserveEpisode = false) {
    if (this.#active) this.ports.observe?.("cancelled", this.#revision, this.#mark);
    this.#revision++; this.#active = false; this.#mark = null;
    this.#voiceMs = 0; this.#caption = false;
    if (!preserveEpisode) this.#recent = { voiceMs: 0, caption: false, at: 0, text: "" };
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#deadline) clearTimeout(this.#deadline);
    this.#timer = null; this.#deadline = null;
  }
}
