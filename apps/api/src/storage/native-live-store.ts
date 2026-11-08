import { randomUUID } from "node:crypto";
import { setTimeout as retryDelay } from "node:timers/promises";
import type postgres from "postgres";
import { encryptJson, type DataEncryptionMaterial } from "../security/encryption";
import { decryptJson } from "../security/encryption";
import { nativeAppointmentActionSchema, nativeActionTransitionAllowed, type NativeAppointmentAction } from "@callassist/contracts";

export type LiveTraceRow = { traceId?: string; sequence: number; direction: "in" | "out" | "host"; eventType: string;
  observedAt: string; elapsedMs: number; payload: unknown; byteLength: number };
export type NativePrivacy = { callId: string; attemptId: string; recordingId: string; providerCallId: string | null;
  state: "active" | "discard_requested" | "discarded"; reason: string | null; generation: number };
export interface NativeLiveStore {
  reserve(callId: string, attemptId: string): Promise<NativePrivacy>;
  bind(attemptId: string, providerCallId: string): Promise<void>;
  forRecording(recordingId: string): Promise<NativePrivacy | null>;
  get(attemptId: string): Promise<NativePrivacy | null>;
  append(attemptId: string, rows: LiveTraceRow[]): Promise<void>;
  discard(attemptId: string, reason: string): Promise<void>;
  pending(): Promise<NativePrivacy[]>;
  retryDiscard(attemptId: string, generation: number): Promise<void>;
  finishDiscard(attemptId: string, generation: number): Promise<void>;
  readAction(attemptId:string):Promise<NativeAppointmentAction|null>;
  saveAction(action:NativeAppointmentAction):Promise<NativeAppointmentAction>;
}

export class MemoryNativeLiveStore implements NativeLiveStore {
  readonly actions = new Map<string,NativeAppointmentAction[]>();
  async readAction(id:string){const value=this.actions.get(id)?.at(-1);return value?structuredClone(value):null;}
  async saveAction(input:NativeAppointmentAction){
    const value=nativeAppointmentActionSchema.parse(input),state=this.states.get(value.callAttemptId);
    if(!state||state.state!=="active"||state.callId!==value.callBriefId)throw Error("LIVE_CONVERSATION_DISCARDED");
    const history=this.actions.get(value.callAttemptId)??[];
    if(!nativeActionTransitionAllowed(history.at(-1)??null,value))throw Error("LIVE_ACTION_CONFLICT");
    this.actions.set(value.callAttemptId,[...history,structuredClone(value)]);return structuredClone(value);
  }
  readonly states = new Map<string, NativePrivacy>();
  readonly traces = new Map<string, LiveTraceRow[]>();
  readonly #retryAt = new Map<string, number>();
  constructor(private readonly purge: (state: NativePrivacy) => void = () => {}, private readonly onBind: (state: NativePrivacy) => void = () => {}) {}
  async reserve(callId: string, attemptId: string) {
    const state = this.states.get(attemptId) ?? { callId, attemptId, recordingId: randomUUID(), providerCallId: null, state: "active", reason: null, generation: 0 } as NativePrivacy;
    if (state.callId !== callId || state.state !== "active") throw new Error("LIVE_ATTEMPT_UNAVAILABLE");
    this.states.set(attemptId, state); return { ...state };
  }
  async bind(attemptId: string, providerCallId: string) {
    const state = this.states.get(attemptId); if (!state) throw new Error("LIVE_ATTEMPT_UNAVAILABLE");
    if (state.providerCallId && state.providerCallId !== providerCallId) throw new Error("LIVE_PROVIDER_MISMATCH");
    state.providerCallId = providerCallId; this.onBind(state);
  }
  async forRecording(id: string) { const state = [...this.states.values()].find(s => s.recordingId === id); return state ? { ...state } : null; }
  async get(id: string) { const state = this.states.get(id); return state ? { ...state } : null; }
  async append(id: string, rows: LiveTraceRow[]) {
    if (this.states.get(id)?.state !== "active") return;
    const existing = this.traces.get(id) ?? [], keys = new Set(existing.map(row => `${row.traceId ?? id}:${row.sequence}`));
    this.traces.set(id, [...existing, ...structuredClone(rows.filter(row => !keys.has(`${row.traceId ?? id}:${row.sequence}`)))]);
  }
  async discard(id: string, reason: string) {
    const state = this.states.get(id); if (!state) throw new Error("LIVE_ATTEMPT_UNAVAILABLE");
    this.#retryAt.delete(id); state.generation++; state.state = "discard_requested"; state.reason ??= reason; this.traces.delete(id); this.actions.delete(id); this.purge(state);
  }
  async pending() { return [...this.states.values()].filter(s => s.state === "discard_requested" && s.providerCallId && (this.#retryAt.get(s.attemptId)??0)<=Date.now()).map(s => ({ ...s })); }
  async retryDiscard(id: string,generation: number) {if(this.states.get(id)?.generation===generation)this.#retryAt.set(id,Date.now()+30_000);}
  async finishDiscard(id: string, generation: number) { const state = this.states.get(id); if (state?.state === "discard_requested" && state.generation === generation) state.state = "discarded"; }
}

export class PostgresNativeLiveStore implements NativeLiveStore {
  constructor(private readonly sql: postgres.Sql, private readonly key: DataEncryptionMaterial, private readonly traceSql: postgres.Sql = sql) {}
  async readAction(attemptId:string){
    const [row]=await this.sql`SELECT payload_ciphertext FROM live_native_action_revisions WHERE call_attempt_id=${attemptId} ORDER BY revision DESC LIMIT 1`;
    return row?nativeAppointmentActionSchema.parse(decryptJson(row.payload_ciphertext,this.key)):null;
  }
  async saveAction(input:NativeAppointmentAction){
    const action=nativeAppointmentActionSchema.parse(input);
    return this.sql.begin(async tx=>{
      await tx`SELECT id FROM call_briefs WHERE id=${action.callBriefId} AND data_deleted_at IS NULL FOR UPDATE`;
      const [state]=await tx`SELECT state FROM live_attempt_privacy WHERE call_attempt_id=${action.callAttemptId} AND call_brief_id=${action.callBriefId} FOR UPDATE`;
      if(!state||state.state!=="active")throw Error("LIVE_CONVERSATION_DISCARDED");
      const [latest]=await tx`SELECT payload_ciphertext FROM live_native_action_revisions WHERE call_attempt_id=${action.callAttemptId} ORDER BY revision DESC LIMIT 1`;
      const previous=latest?nativeAppointmentActionSchema.parse(decryptJson(latest.payload_ciphertext,this.key)):null;
      if(!nativeActionTransitionAllowed(previous,action))throw Error("LIVE_ACTION_CONFLICT");
      await tx`INSERT INTO live_native_action_revisions(id,call_brief_id,call_attempt_id,revision,action_id,state,payload_ciphertext)
        VALUES(${randomUUID()},${action.callBriefId},${action.callAttemptId},${action.revision},${action.id},${action.state},${encryptJson(action,this.key)})`;
      return action;
    });
  }
  async reserve(callId: string, attemptId: string) {
    await this.sql.begin(async tx => {
      await tx`SELECT id FROM call_briefs WHERE id=${callId} AND data_deleted_at IS NULL FOR UPDATE`;
      const [attempt] = await tx`SELECT id FROM call_attempts WHERE id=${attemptId} AND call_brief_id=${callId} AND status IN ('dialing','in_progress') FOR UPDATE`;
      if (!attempt) throw new Error("LIVE_ATTEMPT_UNAVAILABLE");
      await tx`INSERT INTO live_attempt_privacy(call_attempt_id,call_brief_id,recording_id)
        VALUES(${attemptId},${callId},${randomUUID()}) ON CONFLICT(call_attempt_id) DO NOTHING`;
    });
    const state = await this.get(attemptId);
    if (!state || state.state !== "active") throw new Error("LIVE_ATTEMPT_UNAVAILABLE");
    return state;
  }
  async bind(attemptId: string, providerCallId: string) {
    await this.sql.begin(async tx => {
      await tx`SELECT b.id FROM call_briefs b JOIN live_attempt_privacy p ON p.call_brief_id=b.id WHERE p.call_attempt_id=${attemptId} FOR UPDATE OF b`;
      const [row] = await tx`UPDATE live_attempt_privacy SET provider_call_id=COALESCE(provider_call_id,${providerCallId})
        WHERE call_attempt_id=${attemptId} AND (provider_call_id IS NULL OR provider_call_id=${providerCallId}) RETURNING *`;
      if (!row) throw new Error("LIVE_PROVIDER_MISMATCH");
      // This is a declared recording intent, not an affirmative consent receipt.
      await tx`INSERT INTO call_recordings(id,call_brief_id,call_attempt_id,provider,provider_call_id,status,consent_granted_at,recording_basis,created_at,updated_at)
        VALUES(${row.recording_id},${row.call_brief_id},${attemptId},'twilio',${providerCallId},'starting',NULL,'declarative_local',now(),now())
        ON CONFLICT(id) DO NOTHING`;
    });
  }
  async forRecording(id: string) {
    const [row] = await this.sql`SELECT call_attempt_id FROM live_attempt_privacy WHERE recording_id=${id}`;
    return row ? this.get(row.call_attempt_id) : null;
  }
  async get(id: string) {
    const [row] = await this.sql<NativePrivacy[]>`SELECT call_brief_id AS "callId",call_attempt_id AS "attemptId",recording_id AS "recordingId",
      provider_call_id AS "providerCallId",state,reason,generation FROM live_attempt_privacy WHERE call_attempt_id=${id}`;
    return row ?? null;
  }
  async append(attemptId: string, rows: LiveTraceRow[]) {
    if (!rows.length) return;
    await this.traceSql.begin(async tx => {
      await tx`SELECT b.id FROM call_briefs b JOIN live_attempt_privacy p ON p.call_brief_id=b.id
        WHERE p.call_attempt_id=${attemptId} AND b.data_deleted_at IS NULL FOR SHARE OF b`;
      const [state] = await tx`SELECT p.* FROM live_attempt_privacy p JOIN call_briefs b ON b.id=p.call_brief_id
        WHERE p.call_attempt_id=${attemptId} AND p.state='active' AND b.data_deleted_at IS NULL FOR SHARE OF p`;
      if (!state) return;
      const events=rows.map(row=>({call_attempt_id:attemptId,call_brief_id:state.call_brief_id,trace_id:row.traceId??attemptId,
        sequence:row.sequence,direction:row.direction,event_type:row.eventType,observed_at:row.observedAt,elapsed_ms:row.elapsedMs,byte_length:row.byteLength}));
      const payloads=rows.map(row=>({call_attempt_id:attemptId,trace_id:row.traceId??attemptId,sequence:row.sequence,payload_ciphertext:encryptJson(row.payload,this.key)}));
      await tx`INSERT INTO live_trace_events ${tx(events)} ON CONFLICT(call_attempt_id,trace_id,sequence) DO NOTHING`;
      await tx`INSERT INTO live_trace_payloads ${tx(payloads)} ON CONFLICT(call_attempt_id,trace_id,sequence) DO NOTHING`;
    });
  }

  async discard(attemptId: string, reason: string) {
    // Worker updates may acquire row locks before their content-fence trigger.
    // Retry a rolled-back deadlock/serialization victim, never a committed delete.
    for (let retry = 0; ; retry++) try {
      await this.sql.begin(async tx => {
      const [state] = await tx`SELECT p.call_brief_id FROM live_attempt_privacy p JOIN call_briefs b ON b.id=p.call_brief_id
        WHERE p.call_attempt_id=${attemptId} FOR UPDATE OF b`;
      if (!state) throw new Error("LIVE_ATTEMPT_UNAVAILABLE");
      await tx`UPDATE live_attempt_privacy SET state='discard_requested',generation=generation+1,next_retry_at=now(),reason=COALESCE(reason,${reason}),requested_at=COALESCE(requested_at,now()),updated_at=now()
        WHERE call_attempt_id=${attemptId}`;
      await tx`SELECT discard_live_conversation(${attemptId}::uuid)`;
      });
      return;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (retry >= 2 || !["40P01", "40001"].includes(code ?? "")) throw error;
      await retryDelay(25 * (retry + 1));
    }
  }
  async pending() {
    return this.sql<NativePrivacy[]>`SELECT call_brief_id AS "callId",call_attempt_id AS "attemptId",recording_id AS "recordingId",
      provider_call_id AS "providerCallId",state,reason,generation FROM live_attempt_privacy WHERE state='discard_requested' AND provider_call_id IS NOT NULL AND next_retry_at<=now() ORDER BY next_retry_at,requested_at LIMIT 32`;
  }
  async retryDiscard(id: string,generation: number) {
    await this.sql`UPDATE live_attempt_privacy SET next_retry_at=now()+interval '30 seconds',cleanup_attempts=cleanup_attempts+1,
      last_error_code='PROVIDER_CLEANUP_FAILED',updated_at=now() WHERE call_attempt_id=${id} AND state='discard_requested' AND generation=${generation}`;
  }
  async finishDiscard(id: string, generation: number) {
    await this.sql`UPDATE live_attempt_privacy SET state='discarded',cleanup_attempts=cleanup_attempts+1,last_error_code=NULL,updated_at=now() WHERE call_attempt_id=${id} AND state='discard_requested' AND generation=${generation}`;
  }
}
