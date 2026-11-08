import type { CallTelemetryPayload, LiveRuntimeDiagnostic } from "@callassist/contracts";

const MAX_PENDING_EVENTS = 64;

/** Optional diagnostics only. Never use this queue for consent, actions or provider accounting. */
export class LiveTelemetry {
  #queue: Array<{ key: string; payload: CallTelemetryPayload }> = [];
  #writing = false;
  #failed = 0;
  #dropped = 0;
  #diagnosticSequence = 0;

  constructor(
    private readonly write: (key: string, payload: CallTelemetryPayload) => Promise<unknown>,
    private readonly warn: (details: { code: "LIVE_TELEMETRY_UNAVAILABLE"; reason: "write_failed" | "queue_full";
      failed: number; dropped: number }) => void,
    private readonly runtimeVersion: "live-managed-v9" | "live-native-v1" = "live-managed-v9"
  ) {}

  diagnostic(diagnostic: LiveRuntimeDiagnostic) {
    const revision = ++this.#diagnosticSequence;
    this.record(`live:runtime-diagnostic:${revision}`, { name: "conversation.task", metadata: {
      runtimeVersion: this.runtimeVersion, phase: "diagnostic", revision, diagnostic
    } });
  }

  record(key: string, payload: CallTelemetryPayload) {
    // A hung storage write retains one owner. Do not turn a timeout into more
    // concurrent writes or an unbounded queue, and do not delay voice playback.
    if (this.#queue.length + Number(this.#writing) >= MAX_PENDING_EVENTS) {
      this.#dropped++;
      this.#report("queue_full", this.#dropped);
      return;
    }
    this.#queue.push({ key, payload });
    if (!this.#writing) void this.#drain();
  }

  async #drain() {
    this.#writing = true;
    try {
      while (this.#queue.length) {
        const event = this.#queue.shift()!;
        try { await this.write(event.key, event.payload); }
        catch {
          this.#failed++;
          this.#report("write_failed", this.#failed);
        }
      }
    } finally { this.#writing = false; }
  }

  #report(reason: "write_failed" | "queue_full", count: number) {
    // Log the first loss and powers of two; no payloads or storage error text.
    if (count !== 1 && !Number.isInteger(Math.log2(count))) return;
    try { this.warn({ code: "LIVE_TELEMETRY_UNAVAILABLE", reason, failed: this.#failed, dropped: this.#dropped }); }
    catch { /* Even a diagnostic logger must not terminate the conversation. */ }
  }
}
