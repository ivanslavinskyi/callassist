import { randomUUID } from "node:crypto";
import type { LiveTraceRow, NativeLiveStore } from "../storage/native-live-store";

const forbidden = /^(authorization|api[_-]?key|.*token|cookie|set-cookie|.*secret|password)$/i;
function protect(value: unknown, key = ""): unknown {
  if (forbidden.test(key)) return "[omitted]";
  if (key === "audio" && typeof value === "string") return "[audio omitted]";
  if (Array.isArray(value)) return value.map(item => protect(item));
  if (value && typeof value === "object") {
    const audio = /audio\.(append|delta)$/.test(String((value as Record<string,unknown>).type));
    return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,audio && k === "delta" ? "[audio omitted]" : protect(v,k)]));
  }
  return value;
}

/** Separate bounded asynchronous channel. Audio frames are aggregated, never
 * written as base64. All conversational payloads are encrypted by the store.
 * Queue loss is counted explicitly; callers never await storage on the media path. */
export class LiveProtocolTrace {
  readonly #traceId = randomUUID();
  #sequence = 0; #queue: LiveTraceRow[] = []; #bytes = 0; #dropped = 0;
  #protocolStarted=false; #protocolClosed=false; #drainTimeout=false;
  #writing: Promise<void> | null = null; #closed = false; #discarded = false;
  readonly #started = performance.now();
  #audio = new Map<string, { frames: number; bytes: number; first: number; last: number }>();
  constructor(private readonly store: NativeLiveStore, private readonly attemptId: string,
    private readonly warn: (code: string) => void = () => {}) {}
  event(direction: LiveTraceRow["direction"], event: Record<string, unknown>) {
    if (this.#closed || this.#discarded) return;
    const type = typeof event.type === "string" ? event.type : "host.unknown";
    if(type==="session.started")this.#protocolStarted=true;
    if(type==="session.closed")this.#protocolClosed=true;
    if(type==="trace.drain_timeout")this.#drainTimeout=true;
    if (/audio\.(append|delta)$/.test(type)) {
      const encoded = event.audio ?? event.delta;
      const key = `${direction}:${type}`, now = performance.now();
      const bucket = this.#audio.get(key) ?? { frames: 0, bytes: 0, first: now, last: now };
      bucket.frames++; bucket.bytes += typeof encoded === "string" ? Buffer.byteLength(encoded,"base64") : 0; bucket.last = now;
      this.#audio.set(key,bucket);
      if (now-bucket.first >= 1000) this.#flushAudio();
      return;
    }
    // Transcript deltas are text. The generic secret/audio filter must not erase them.
    const safe = protect(event) as Record<string, unknown>;
    if (/transcript\.delta$/.test(type) && typeof event.delta === "string") safe.delta = event.delta;
    this.#enqueue(direction,type,safe);
  }
  #enqueue(direction: LiveTraceRow["direction"], eventType: string, payload: unknown) {
    const byteLength = Buffer.byteLength(JSON.stringify(payload));
    const sequence = ++this.#sequence;
    if (byteLength > 256_000 || this.#queue.length >= 256 || this.#bytes+byteLength > 2_000_000) { this.#dropped++; return; }
    this.#queue.push({ traceId:this.#traceId,sequence,direction,eventType,observedAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()-this.#started),payload,byteLength });
    this.#bytes += byteLength; this.#pump();
  }
  #flushAudio() {
    for (const [channel,stats] of this.#audio) this.#enqueue("host","audio.batch",{ channel,...stats,durationMs:stats.bytes/8 });
    this.#audio.clear();
  }
  #pump() {
    if (this.#writing || this.#discarded || !this.#queue.length) return;
    const rows = this.#queue.splice(0,32); this.#bytes -= rows.reduce((sum,row)=>sum+row.byteLength,0);
    this.#writing = this.store.append(this.attemptId,rows).catch(() => {
      this.#dropped += rows.length; this.warn("LIVE_TRACE_WRITE_FAILED");
    }).finally(() => { this.#writing=null; this.#pump(); });
  }
  discard() { this.#discarded=true; this.#queue=[]; this.#audio.clear(); this.#bytes=0; }
  async close() {
    if (this.#closed || this.#discarded) return;
    this.#flushAudio(); this.#closed=true;
    while (this.#writing) await this.#writing;
    const dropped=this.#dropped;
    // A final manifest records completeness even when an earlier batch was lost.
    await this.store.append(this.attemptId,[{ traceId:this.#traceId,sequence:++this.#sequence,direction:"host",eventType:"trace.manifest",observedAt:new Date().toISOString(),
      elapsedMs:Math.round(performance.now()-this.#started),byteLength:0,payload:{version:1,dropped,complete:dropped===0 && (!this.#protocolStarted || this.#protocolClosed),sessionClosed:this.#protocolClosed,drainTimeout:this.#drainTimeout,audio:"metadata_only"} }]).catch(()=>this.warn("LIVE_TRACE_MANIFEST_FAILED"));
  }
}
