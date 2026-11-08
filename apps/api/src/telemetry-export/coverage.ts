import {ExportTiming,exportTimingEvents} from "./timing";
type Row = Record<string, unknown>;
type Trace = { sequences: Set<number>; payloads: Set<number>; manifestSequence?: number; manifest?: Row; started: boolean; timed:Map<number,{type:string;at:number}>; timing:ExportTiming };
type Attempt = { id: string; callId?: string; native?: boolean; selected?: boolean; ended?: boolean; capture?: string; privacy?: string; traces: Map<string, Trace>; sessions: Set<string> };
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};

/** Bounded by the archive's existing record/byte limits; retains metadata only. */
export class ExportCoverage {
  private readonly attempts = new Map<string, Attempt>();
  private readonly results = new Map<string, string>();
  private readonly usage = new Set<string>();
  private readonly deletedCalls = new Set<string>();
  private groundingRepairRequests=0;
  private attempt(id: unknown) {
    const key = String(id);
    if (!this.attempts.has(key)) this.attempts.set(key, { id: key, traces: new Map(), sessions: new Set() });
    return this.attempts.get(key)!;
  }
  observe(table: string, data: Row, selected = false) {
    if(table==="provider_operations"&&String(data.stage).endsWith(".grounding_repair"))this.groundingRepairRequests++;
    if (table === "call_briefs" && data.data_deleted_at) this.deletedCalls.add(String(data.id));
    if (table === "call_attempts") {
      Object.assign(this.attempt(data.id), { callId: String(data.call_brief_id), selected,
        native: object(data.runtime_descriptor).runtime === "live_native_v2", ended: !!data.ended_at,
        capture: object(data.native_transcript_capture).status });
    }
    if (table === "live_attempt_privacy") this.attempt(data.call_attempt_id).privacy = String(data.state);
    if (table === "live_trace_events" || table === "live_trace_payloads") {
      const attempt = this.attempt(data.call_attempt_id), id = String(data.trace_id);
      if (!attempt.traces.has(id)) attempt.traces.set(id, { sequences: new Set(), payloads: new Set(), started: false,timed:new Map(),timing:new ExportTiming() });
      const trace = attempt.traces.get(id)!, sequence = Number(data.sequence);
      if (table === "live_trace_events") {
        trace.sequences.add(sequence);
        trace.started ||= data.event_type === "session.started";
        if(exportTimingEvents.has(String(data.event_type))&&typeof data.elapsed_ms==="number")trace.timed.set(sequence,{type:String(data.event_type),at:data.elapsed_ms});
        if (data.event_type === "trace.manifest") trace.manifestSequence = sequence;
      } else {
        trace.payloads.add(sequence);
        // Events are streamed before payloads in the versioned export source list.
        if (sequence === trace.manifestSequence) trace.manifest = object(data.payload);
        const timed=trace.timed.get(sequence);if(timed){trace.timing.observe(timed.type,timed.at,object(data.payload));trace.timed.delete(sequence);}
      }
    }
    if (table === "provider_operations" && data.operation_type === "realtime_session" && data.stage === "live_conversation" && data.call_attempt_id)
      this.attempt(data.call_attempt_id).sessions.add(String(data.id));
    if (table === "provider_operation_results") this.results.set(String(data.operation_id), String(data.outcome));
    if (table === "effective_provider_usage" && (typeof data.duration_seconds === "number" || typeof data.billable_seconds === "number") && object(data.raw_usage).finalized === true) this.usage.add(String(data.operation_id));
  }
  finish(audio: Row[]) {
    const attempts = [...this.attempts.values()].filter(a => a.callId).map(a => {
      const deleted = this.deletedCalls.has(a.callId!) || ["discarded", "discard_requested"].includes(a.privacy ?? "");
      const traces = [...a.traces].map(([id, t]) => {
        let last = 0; for (const sequence of t.sequences) last = Math.max(last, sequence);
        const gaps = last - t.sequences.size;
        const missingPayloads = [...t.sequences].filter(sequence => !t.payloads.has(sequence)).length;
        const complete = t.manifest?.complete === true && t.manifest.dropped === 0 && t.manifest.drainTimeout === false &&
          (!t.started || t.manifest.sessionClosed === true) && gaps === 0 && missingPayloads === 0 && t.manifestSequence === last;
        return { traceId: id, status: complete ? "complete" : "incomplete", manifestPresent: !!t.manifest,
          sequenceGaps: gaps, missingPayloads, dropped: typeof t.manifest?.dropped === "number" ? t.manifest.dropped : null,
          droppedFraction: typeof t.manifest?.dropped === "number" && last>1 ? t.manifest.dropped/(last-1) : null,
          sessionClosed: t.manifest?.sessionClosed ?? null, drainTimeout: t.manifest?.drainTimeout ?? null, timing:t.timing.result() };
      });
      const trace = deleted ? "deleted" : traces.length ? traces.every(t => t.status === "complete") ? "complete" : "incomplete" : a.native ? a.ended ? "missing" : "pending" : "legacy_unavailable";
      const transcript = deleted ? "deleted" : a.capture === "collecting" ? "pending" : a.capture ?? (a.native ? a.ended ? "missing" : "pending" : "legacy_unavailable");
      const usage = a.sessions.size ? [...a.sessions].every(id => this.results.get(id) === "succeeded" && this.usage.has(id)) ? "final" : "incomplete"
        : a.native && [...a.traces.values()].some(t=>t.started) ? "missing" : a.native ? "unavailable" : "legacy_unavailable";
      return { attemptId: a.id, callId: a.callId, selectedInPeriod: a.selected, trace, traces: deleted ? [] : traces,
        transcript, usage, audio: audio.filter(r => r.attemptId === a.id).map(r => ({ recordingId: r.recordingId, status: r.status })) };
    });
    return { version: 1, attempts, incompleteAttempts: attempts.filter(a =>
      ["incomplete", "missing", "pending"].includes(a.trace) || ["incomplete", "missing", "pending"].includes(a.transcript) || ["incomplete","missing"].includes(a.usage)).length,
      unavailableCalls: this.deletedCalls.size,groundingRepairRequests:this.groundingRepairRequests,
      timingPolicy: "Caption timestamps are evidence of transcription, not audible playback. Use application_playback and closing.playback marks for delivery; missing timing is unknown." };
  }
}
