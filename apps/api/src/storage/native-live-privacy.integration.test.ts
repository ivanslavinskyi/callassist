import "../config/load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "./postgres-call-repository";
import { nativeAction } from "../test-helpers/native-appointment";
import { approvedCall } from "../voice/voice-test-helpers";

const db=isolatedTestDatabase(),sql=postgres(db.url,{max:3,onnotice:()=>{}}),key=Buffer.alloc(32,12);
beforeAll(()=>db.setup());afterAll(async()=>{await sql.end();await db.teardown();});
describe("durable native refusal",()=>{
  it("journals encrypted action revisions with concurrency control and fences them on refusal",async()=>{
    const repository=new PostgresCallRepository(db.url,key),h=await approvedCall(undefined,repository,"en-GB","CA-native-action");
    try{
      await repository.nativeLive.reserve(h.brief.id,h.attempt.id);
      const action=nativeAction(h.brief.id,h.attempt.id,h.snapshot.compilationSnapshotHash);
      await repository.nativeLive.saveAction(action);
      const [row]=await sql`SELECT payload_ciphertext FROM live_native_action_revisions WHERE call_attempt_id=${h.attempt.id}`;
      expect(row!.payload_ciphertext).not.toContain("Nina");
      const next={...action,state:"uncertain" as const,revision:2};
      const race=await Promise.allSettled([repository.nativeLive.saveAction(next),repository.nativeLive.saveAction(next)]);
      expect(race.filter(r=>r.status==="fulfilled")).toHaveLength(1);
      expect(await repository.nativeLive.readAction(h.attempt.id)).toMatchObject({state:"uncertain",revision:2});
      expect((await repository.exportCallTextData(h.brief.id)).nativeAppointmentActions).toHaveLength(2);
      await repository.nativeLive.discard(h.attempt.id,"recording_refused");
      expect(await repository.nativeLive.readAction(h.attempt.id)).toBeNull();
      await expect(repository.nativeLive.saveAction({...next,state:"authorized",intent:"status_check",episode:2,revision:3})).rejects.toThrow("LIVE_CONVERSATION_DISCARDED");
      expect((await repository.exportCallTextData(h.brief.id)).nativeAppointmentActions).toEqual([]);
    }finally{await h.service.close();}
  });
  it("erases text and encrypted trace, preserves the approved task, fences late writes and revokes exports",async()=>{
    const repository=new PostgresCallRepository(db.url,key),h=await approvedCall(undefined,repository);
    try{
      const privacy=await repository.nativeLive.reserve(h.brief.id,h.attempt.id);
      await repository.nativeLive.bind(h.attempt.id,"CA-LIVE");
      const snapshot=await repository.get(h.brief.id);expect(snapshot?.recording).toMatchObject({consentGrantedAt:null,recordingBasis:"declarative_local"});
      const timing={sessionId:"privacy-test",eventId:"transcript-1",sessionStartedAt:new Date().toISOString(),startMs:0,endMs:1000};
      await repository.addTranscript(h.brief.id,"recipient","Private answer","en-GB",timing);
      await repository.nativeLive.append(h.attempt.id,[{sequence:1,direction:"in",eventType:"session.input_transcript.delta",observedAt:new Date().toISOString(),elapsedMs:1,byteLength:20,payload:{text:"Private answer"}}]);
      const [cipher]=await sql`SELECT payload_ciphertext FROM live_trace_payloads WHERE call_attempt_id=${h.attempt.id}`;
      expect(cipher?.payload_ciphertext).not.toContain("Private answer");
      const [before]=await sql`SELECT revision FROM admin_telemetry_privacy_epoch WHERE id=true`;
      const inFlight=Array.from({length:8},(_,index)=>repository.nativeLive.append(h.attempt.id,[{
        sequence:index+2,direction:"in",eventType:"session.input_transcript.delta",observedAt:new Date().toISOString(),
        elapsedMs:2,byteLength:20,payload:{text:"Concurrent private answer"}
      }]));
      await repository.nativeLive.discard(h.attempt.id,"recording_refused");
      await Promise.all(inFlight);
      const after=await repository.get(h.brief.id);
      expect(after?.transcript).toEqual([]);expect(after?.compilation?.snapshotHash).toBe(h.snapshot.compilationSnapshotHash);
      expect(await sql`SELECT * FROM live_trace_payloads WHERE call_attempt_id=${h.attempt.id}`).toHaveLength(0);
      await expect(repository.addTranscript(h.brief.id,"recipient","Late answer","en-GB",{...timing,eventId:"late"})).rejects.toThrow("LIVE_CONVERSATION_DISCARDED");
      await repository.setNativeTranscriptCapture(h.brief.id,h.attempt.id,{version:1,sessionId:"privacy-test",model:"gpt-live-1",status:"complete",updatedAt:new Date().toISOString()});
      expect((await repository.get(h.brief.id))?.nativeTranscriptCapture).toBeNull();
      const [epoch]=await sql`SELECT revision FROM admin_telemetry_privacy_epoch WHERE id=true`;expect(Number(epoch!.revision)).toBeGreaterThan(Number(before!.revision));
      const pending=(await repository.nativeLive.pending()).find(s=>s.attemptId===h.attempt.id)!;
      expect(pending.recordingId).toBe(privacy.recordingId);
      await repository.nativeLive.discard(h.attempt.id,"recording_refused");
      await repository.nativeLive.finishDiscard(h.attempt.id,pending.generation);
      expect((await repository.nativeLive.get(h.attempt.id))?.state).toBe("discard_requested");
      const state=(await repository.nativeLive.get(h.attempt.id))!;
      await repository.nativeLive.retryDiscard(h.attempt.id,state.generation);
      expect((await repository.nativeLive.pending()).some(s=>s.attemptId===h.attempt.id)).toBe(false);
      await repository.nativeLive.discard(h.attempt.id,"recording_refused");
      expect((await repository.nativeLive.pending()).some(s=>s.attemptId===h.attempt.id)).toBe(true);
    }finally{await h.service.close();}
  });
});
