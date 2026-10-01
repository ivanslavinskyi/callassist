import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeCreateCallBriefInput, type CreateCallBriefInput } from "@callassist/contracts";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { PostgresCallRepository } from "./postgres-call-repository";
import { InMemoryCallRepository } from "./in-memory-call-repository";
import { assembleNativeTranscript } from "./native-transcript";

const fixture=isolatedTestDatabase();
beforeAll(()=>fixture.setup());
afterAll(()=>fixture.teardown());
const input:CreateCallBriefInput={recipientName:"Office",phoneNumber:"+41710000001",objective:"Ask opening hours",
  assistantProfileId:"anna",representedPersonFirstName:"Nina",representedPersonLastName:"Keller",assistanceReason:"speech_impairment",
  locale:"de-CH",audioRetentionDays:7,allowLanguageSwitch:false,allowedFacts:[]};

describe.each(["memory","postgres"])("%s optional recording transcript",mode=>{
  async function setup() {
    const repository=mode==='postgres'?new PostgresCallRepository(fixture.url,Buffer.alloc(32,7)):new InMemoryCallRepository();
    const owner=randomUUID(),sql=postgres(fixture.url,{max:1,onnotice:()=>undefined});
    if(mode==='postgres') await sql`INSERT INTO users(id,email,password_hash,phone_e164,phone_verified_at,first_name,last_name,role,status,ui_locale,created_at)
      VALUES(${owner},${owner+'@example.com'},'test',${'+417'+String(parseInt(owner.slice(0,8),16)).padStart(10,'0')},now(),'Nina','Keller','user','active','de',now())`;
    const compilation=await new DeterministicBriefCompiler().compile(normalizeCreateCallBriefInput(input));
    const brief=await repository.create(input,compilation,owner);
    await repository.approveCompilation(brief.id,await originalPlanReview(repository,brief.id));
    const {attempt}=await repository.startAttempt(brief.id,{provider:'twilio'});
    await repository.attachProviderCall(attempt.id,'CA-'+brief.id,'in-progress');
    const recording=(await repository.beginRecording(brief.id,{method:'voice',decision:'affirmative',locale:'de-CH'})).recording;
    await repository.attachProviderRecording(recording.id,'RE-'+brief.id,'in-progress');
    await repository.applyRecordingStatus({callBriefId:brief.id,recordingId:recording.id,providerCallId:'CA-'+brief.id,providerRecordingId:'RE-'+brief.id,providerStatus:'completed',durationSeconds:20,channels:2});
    const origin=new Date().toISOString();
    const capture={version:1 as const,sessionId:randomUUID(),model:'gpt-live-1',status:'incomplete' as const,sessionStartedAt:origin,updatedAt:origin};
    await repository.setNativeTranscriptCapture(brief.id,attempt.id,capture);
    await repository.addTranscript(brief.id,'recipient','Am Dienstag.','de-CH',
      {sessionId:capture.sessionId,eventId:'answer',sessionStartedAt:origin,startMs:1000,endMs:2000});
    const result=assembleNativeTranscript((await repository.get(brief.id))!,capture)!;
    await repository.publishNativeTranscript(brief.id,attempt.id,result);
    return {repository,owner,brief,attempt,recording,sql,close:async()=>{await repository.close();await sql.end();}};
  }
  it("keeps Live primary, rejects foreign requests, admits one job, caches ASR and preserves revisions after audio deletion",async()=>{
    const f=await setup();const {repository,owner,brief,recording}=f;
    try {
      const before=(await repository.get(brief.id))!;
      await repository.seedDurableJobs(new Date().toISOString());
      expect((await repository.listDurableJobs()).filter(j=>j.type==='final_transcription')).toHaveLength(0);
      expect(before.finalTranscript?.quality?.coverage).toBe('partial');
      await expect(repository.requestRecordingTranscript(brief.id,randomUUID(),'asr-test')).rejects.toThrow();
      await Promise.all([repository.requestRecordingTranscript(brief.id,owner,'asr-test'),repository.requestRecordingTranscript(brief.id,owner,'asr-test')]);
      const jobs=(await repository.listDurableJobs()).filter(j=>j.type==='final_transcription');
      expect(jobs).toHaveLength(1);expect(jobs[0].generation).toBe(1);
      const job=(await repository.claimDueDurableJob({types:['final_transcription'],workerId:'worker',now:new Date().toISOString(),leaseExpiresAt:new Date(Date.now()+60000).toISOString()}))!;
      const lease={jobId:job.id,workerId:'worker',checkedAt:new Date().toISOString()};
      await repository.claimFinalTranscript(recording.id,'asr-test',false,lease);
      await repository.completeFinalTranscript(recording.id,'Am Donnerstag.',[{role:'recipient',text:'Am Donnerstag.',startSeconds:1,endSeconds:2}],lease);
      await repository.completeDurableJob(job.id,'worker',new Date().toISOString());
      const ready=(await repository.get(brief.id))!;
      expect(ready.finalTranscriptRevision).toEqual(before.finalTranscriptRevision);
      expect(ready.recordingTranscriptRevision?.text).toBe('Am Donnerstag.');
      expect(ready.recordingTranscriptRevision?.id).not.toBe(ready.finalTranscriptRevision?.id);
      expect(ready.recording?.deleteAfter).toBe(before.recording?.deleteAfter);
      await repository.requestRecordingTranscript(brief.id,owner,'asr-test');
      expect((await repository.listDurableJobs()).find(j=>j.type==='final_transcription')?.generation).toBe(1);
      await repository.requestRecordingDeletion(brief.id);await repository.markRecordingDeleted(brief.id);
      await repository.requestRecordingTranscript(brief.id,owner,'asr-test');
      const deleted=(await repository.get(brief.id))!;
      expect(deleted.finalTranscriptRevision).toEqual(ready.finalTranscriptRevision);
      expect(deleted.recordingTranscriptRevision).toEqual(ready.recordingTranscriptRevision);
    } finally {await f.close();}
  });
  it("fences requests and publication as soon as deletion is requested, without extending retention",async()=>{
    const f=await setup();const {repository,owner,brief,recording}=f;
    try {
      await repository.requestRecordingTranscript(brief.id,owner,'asr-test');
      const job=(await repository.claimDueDurableJob({types:['final_transcription'],workerId:'worker',now:new Date().toISOString(),leaseExpiresAt:new Date(Date.now()+60000).toISOString()}))!;
      const lease={jobId:job.id,workerId:'worker',checkedAt:new Date().toISOString()};
      await repository.claimFinalTranscript(recording.id,'asr-test',false,lease);
      await repository.requestRecordingDeletion(brief.id);
      await expect(repository.requestRecordingTranscript(brief.id,owner,'asr-test')).rejects.toThrow();
      await expect(repository.reservePostCallTranscriptionProviderRequest({id:randomUUID(),clientRequestId:randomUUID(),provider:'openai',operationType:'transcription',stage:'full_recording',requestedModel:'asr-test',startedAt:new Date().toISOString(),durableJobGeneration:job.generation,recordingId:recording.id,callBriefId:brief.id},lease)).rejects.toThrow();
      await expect(repository.completeFinalTranscript(recording.id,'Late',[],lease)).rejects.toThrow();
      await repository.markRecordingDeleted(brief.id);
      expect((await repository.listDurableJobs()).find(j=>j.type==='final_transcription'&&j.recordingId===recording.id)?.status).toBe('cancelled');
      expect((await repository.get(brief.id))?.finalTranscript?.text).toContain('Am Dienstag.');
    } finally {await f.close();}
  });
});
