import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { DurableJobWorker } from "../jobs/durable-job-worker";
import { normalizeCreateCallBriefInput, type CallAssessmentDecision, type CallSummaryPayload } from "@callassist/contracts";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import type { CallRepository } from "./call-repository";

export function finalAssessmentSuite(make:()=>Promise<{repository:CallRepository;owner:string;reopen?:()=>Promise<CallRepository>}>) {
  async function fixture(consent=true) {
    const {repository:r,owner,reopen}=await make();
    await r.grantSignupCredits(owner);
    const input=normalizeCreateCallBriefInput({recipientName:"Office",phoneNumber:"+41523686688",objective:"Ask what they want for dinner",
      assistantProfileId:"sebastian",representedPersonFirstName:"Nina",representedPersonLastName:"Example",locale:"en-GB",allowLanguageSwitch:false,allowedFacts:[]});
    const c=await new DeterministicBriefCompiler().compile(input), brief=await r.create(input,c,owner);
    await r.approveCompilation(brief.id,await originalPlanReview(r,brief.id));
    const {attempt}=await r.startAttempt(brief.id,{userId:owner,provider:"twilio"});
    await r.attachProviderCall(attempt.id,`CA-${attempt.id}`,"in-progress");
    if (!consent) return {r,owner,brief,attempt,c,recording:null,reopen};
    const {recording}=await r.beginRecording(brief.id);
    await r.attachProviderRecording(recording.id,`RE-${recording.id}`,"in-progress");
    // The provisional ASR misses the task answer. It must not decide billing.
    await r.addTranscript(brief.id,"assistant","What would you like for dinner?","en-GB");
    await r.addTranscript(brief.id,"recipient","I speak","en-GB");
    return {r,owner,brief,attempt,c,recording,reopen};
  }
  async function final(f:Awaited<ReturnType<typeof fixture>>, category:CallAssessmentDecision["conversation"]["category"]="task_answer") {
    const {r,brief,recording,c}=f;
    await r.applyRecordingStatus({callBriefId:brief.id,recordingId:recording!.id,providerCallId:`CA-${f.attempt.id}`,providerRecordingId:`RE-${recording!.id}`,
      providerStatus:"completed",durationSeconds:35,channels:2});
    await r.claimFinalTranscript(recording!.id,"test-transcriber");
    const answer=category==="cannot_answer"?"I do not know.":category==="referral"?"Ask the kitchen.":"Pizza, please.";
    await r.completeFinalTranscript(recording!.id,`What would you like for dinner? ${answer}`,[
      {role:"assistant",text:"What would you like for dinner?",startSeconds:1,endSeconds:3},
      {role:"recipient",text:answer,startSeconds:4,endSeconds:6}
    ]);
    const revision=(await r.getCurrentTranscriptRevision(brief.id))!;
    const goal=category==="task_answer"?"achieved" as const:"not_achieved" as const;
    const decision:CallAssessmentDecision={conversation:{status:"confirmed",category,questionSegmentId:revision.segments[0]!.id,
      answerSegmentId:revision.segments[1]!.id,answerQuote:answer},goal:{status:goal,sourceSegmentIds:[revision.segments[1]!.id]},
      criteria:c.compiledBrief!.successCriteria.map((_,i)=>({id:`criterion.${i}`,status:goal,sourceSegmentIds:[revision.segments[1]!.id]}))};
    const payload:CallSummaryPayload={schemaVersion:2,overview:[],findings:[],nextSteps:[],unresolved:[],assessment:decision};
    const artifact=await r.enqueueTextArtifact({callId:brief.id,kind:"call_summary",compilationId:f.attempt.compilationId!,transcriptRevisionId:revision.id,
      sourceHash:revision.sourceHash,targetLanguage:f.attempt.contentLanguage??"en",generatorVersion:"summary-v3:test:openai:fixture"});
    const job=(await r.claimDueDurableJob({types:["text_artifact_generation"],workerId:randomUUID(),now:new Date().toISOString(),leaseExpiresAt:new Date(Date.now()+60000).toISOString()}))!;
    expect(job.textArtifactId).toBe(artifact.id);
    const lease={jobId:job.id,workerId:job.leaseOwner!,checkedAt:new Date().toISOString(),generation:job.generation,attemptNumber:job.attemptCount};
    await r.claimTextArtifact(artifact.id,lease);
    return {artifact,revision,decision,payload,lease};
  }
  it.each(["task_answer","cannot_answer","referral"] as const)("settles %s from final evidence exactly once, independently of goal success",async category=>{
    const f=await fixture();
    await f.r.updateStatus(f.brief.id,"completed");
    expect((await f.r.getCreditUsage(f.owner)).transactions.filter(t=>t.type==="call_refund")).toHaveLength(0);
    expect((await f.r.get(f.brief.id))?.brief.lifecycle?.result).toBe("assessment_pending");
    const v=await final(f,category);
    await f.r.completeTextArtifact(v.artifact.id,v.payload,v.lease);
    await f.r.completeTextArtifact(v.artifact.id,v.payload,v.lease);
    const usage=await f.r.getCreditUsage(f.owner);
    expect(usage.balance).toBe(2);
    expect(usage.transactions.filter(t=>t.type==="call_charge")).toHaveLength(1);
    const snapshot=await f.r.get(f.brief.id);
    expect(snapshot?.brief.lifecycle).toMatchObject({result:"conversation_completed",credit:"used",assessment:{status:"ready",goal:v.decision.goal.status}});
    expect((await f.r.getAdminCallInspector(f.brief.id)).summary.lifecycle).toEqual(snapshot?.brief.lifecycle);
    expect((await f.r.list({userId:f.owner,limit:20})).items[0]?.lifecycle).toEqual(snapshot?.brief.lifecycle);
    const facts=await f.r.getAdminOperationsFacts("2000-01-01T00:00:00.000Z","2099-01-01T00:00:00.000Z",f.brief.id);
    expect(facts.lifecycle?.conversations).toBe(1);
    expect(facts.lifecycle?.goals?.[category==="task_answer"?"achieved":"notAchieved"]).toBe(1);
    expect(facts.userGoalFeedback).toEqual({yes:0,partly:0,no:0,notProvided:1});
  });
  it("expires the reservation after restart and permits a late outcome without a retroactive charge",async()=>{
    const f=await fixture();await f.r.updateStatus(f.brief.id,"completed");
    if (f.reopen) f.r=await f.reopen();
    await f.r.claimDueDurableJob({types:[],workerId:"deadline",now:new Date(Date.now()+360000).toISOString(),leaseExpiresAt:new Date(Date.now()+400000).toISOString()});
    expect((await f.r.get(f.brief.id))?.brief.lifecycle).toMatchObject({result:"assessment_unavailable",credit:"returned"});
    const v=await final(f);await f.r.completeTextArtifact(v.artifact.id,v.payload,v.lease);
    expect((await f.r.get(f.brief.id))?.brief.lifecycle).toMatchObject({result:"conversation_completed",credit:"returned"});
    expect((await f.r.getCreditUsage(f.owner)).balance).toBe(3);
  });
  it("returns credit for absent or uncertain evidence instead of inferring success",async()=>{
    const f=await fixture();await f.r.updateStatus(f.brief.id,"completed");const v=await final(f);
    v.payload.assessment={conversation:{status:"uncertain",category:"uncertain",questionSegmentId:null,answerSegmentId:null,answerQuote:""},
      goal:{status:"uncertain",sourceSegmentIds:[]},criteria:v.decision.criteria.map(c=>({...c,status:"uncertain",sourceSegmentIds:[]}))};
    await f.r.completeTextArtifact(v.artifact.id,v.payload,v.lease);
    expect((await f.r.get(f.brief.id))?.brief.lifecycle).toMatchObject({result:"assessment_unavailable",credit:"returned"});
  });
  it("does not wait for an assessment without consent",async()=>{
    const f=await fixture(false);await f.r.updateStatus(f.brief.id,"completed");
    expect((await f.r.getCreditUsage(f.owner)).balance).toBe(3);
    expect(await f.r.getCallAssessment(f.brief.id,f.attempt.id)).toBeNull();
  });
  it("rejects nonexistent, wrong-speaker and fabricated answer evidence without publishing or charging",async()=>{
    const f=await fixture();await f.r.updateStatus(f.brief.id,"completed");const v=await final(f);
    for(const change of [{answerSegmentId:"other-revision:0"},{answerSegmentId:v.revision.segments[0]!.id},{answerQuote:"Invented answer"}]) {
      const bad={...v.payload,assessment:{...v.decision,conversation:{...v.decision.conversation,...change}}};
      await expect(f.r.completeTextArtifact(v.artifact.id,bad,v.lease)).rejects.toMatchObject({code:"TEXT_ARTIFACT_INVALID"});
    }
    expect((await f.r.getCreditUsage(f.owner)).transactions.filter(t=>t.type==="call_charge")).toHaveLength(0);
    expect((await f.r.getTextArtifact(f.brief.id,v.artifact.id))?.status).toBe("processing");
  });
  it("waits for terminal status even when the summary arrives first",async()=>{
    const f=await fixture(),v=await final(f);
    await f.r.completeTextArtifact(v.artifact.id,v.payload,v.lease);
    expect((await f.r.getCreditUsage(f.owner)).transactions.filter(t=>t.type==="call_charge")).toHaveLength(0);
    await f.r.applyProviderStatus(`CA-${f.attempt.id}`,"completed","completed",f.brief.id);
    expect((await f.r.get(f.brief.id))?.brief.lifecycle).toMatchObject({result:"conversation_completed",credit:"used"});
  });
  it("serializes simultaneous provider callbacks and summary publication",async()=>{
    const f=await fixture(),v=await final(f);
    await Promise.all([
      f.r.applyProviderStatus(`CA-${f.attempt.id}`,"completed","completed",f.brief.id),
      f.r.completeTextArtifact(v.artifact.id,v.payload,v.lease),
      f.r.completeTextArtifact(v.artifact.id,v.payload,v.lease)
    ]);
    expect((await f.r.getCreditUsage(f.owner)).transactions.filter(t=>["call_charge","call_refund"].includes(t.type))).toHaveLength(1);
    expect((await f.r.get(f.brief.id))?.brief.lifecycle).toMatchObject({result:"conversation_completed",credit:"used"});
  });
  it("refunds on an explicit absent answer without treating it as a generation failure",async()=>{
    const f=await fixture();await f.r.updateStatus(f.brief.id,"completed");const v=await final(f);
    v.payload.assessment={conversation:{status:"absent",category:"none",questionSegmentId:null,answerSegmentId:null,answerQuote:""},
      goal:{status:"uncertain",sourceSegmentIds:[]},criteria:v.decision.criteria.map(c=>({...c,status:"uncertain",sourceSegmentIds:[]}))};
    await f.r.completeTextArtifact(v.artifact.id,v.payload,v.lease);
    expect((await f.r.get(f.brief.id))?.brief.lifecycle).toMatchObject({result:"no_substantive_answer",credit:"returned",assessment:{status:"ready"}});
  });
  it("keeps a transient failure reserved but refunds a terminal assessment failure",async()=>{
    const f=await fixture();await f.r.updateStatus(f.brief.id,"completed");const v=await final(f);
    await f.r.failTextArtifact(v.artifact.id,"TEXT_PROVIDER_UNAVAILABLE",v.lease);
    expect((await f.r.get(f.brief.id))?.brief.lifecycle).toMatchObject({result:"assessment_pending",credit:"reserved"});
    await f.r.failTextArtifact(v.artifact.id,"TEXT_PROVIDER_UNAVAILABLE",v.lease,true);
    expect((await f.r.get(f.brief.id))?.brief.lifecycle).toMatchObject({result:"assessment_unavailable",credit:"returned",assessment:{reason:"generation_failed"}});
    await f.r.completeTextArtifact(v.artifact.id,v.payload,v.lease);
    expect((await f.r.get(f.brief.id))?.brief.lifecycle).toMatchObject({result:"conversation_completed",credit:"returned"});
  });
  it("counts latest user feedback independently of the model and exports both evidence and decision",async()=>{
    const f=await fixture();await f.r.updateStatus(f.brief.id,"completed");const v=await final(f);
    await f.r.completeTextArtifact(v.artifact.id,v.payload,v.lease);
    for(const goalResult of ["yes","partly","no"] as const) await f.r.submitOwnerCallFeedback(f.brief.id,f.owner,{idempotencyKey:randomUUID(),goalResult,transcriptQuality:null,comment:null});
    const facts=await f.r.getAdminOperationsFacts("2000-01-01T00:00:00.000Z","2099-01-01T00:00:00.000Z",f.brief.id);
    expect(facts.lifecycle?.goals?.achieved).toBe(1);
    expect(facts.userGoalFeedback).toEqual({yes:0,partly:0,no:1,notProvided:0});
    const data=await f.r.exportCallTextData(f.brief.id);
    expect(data.assessments?.[0]).toMatchObject({callAttemptId:f.attempt.id,compilationId:f.attempt.compilationId,sourceHash:v.revision.sourceHash,decision:v.decision});
  });
  it("isolates a previous attempt assessment and callback from a new attempt",async()=>{
    const f=await fixture();await f.r.updateStatus(f.brief.id,"completed");const v=await final(f);
    await f.r.updateStatus(f.brief.id,"ready");
    const next=await f.r.startAttempt(f.brief.id,{userId:f.owner,provider:"twilio"});
    await f.r.attachProviderCall(next.attempt.id,`CA-${next.attempt.id}`,"ringing");
    await f.r.completeTextArtifact(v.artifact.id,v.payload,v.lease);
    await f.r.applyProviderStatus(`CA-${f.attempt.id}`,"completed","completed",f.brief.id);
    const snapshot=await f.r.get(f.brief.id);
    expect(snapshot?.brief.status).toBe("dialing");
    expect(snapshot?.brief.lifecycle).toMatchObject({result:null,credit:"reserved",substantiveAnswerConfirmed:false});
    expect(snapshot?.brief.lifecycle?.assessment).toBeUndefined();
    expect((await f.r.getCreditUsage(f.owner)).transactions.filter(t=>t.type==="call_charge").map(t=>t.callAttemptId)).toEqual([f.attempt.id]);
    await f.r.applyProviderStatus(`CA-${next.attempt.id}`,"no-answer","failed",f.brief.id);
    expect((await f.r.get(f.brief.id))?.brief.lifecycle).toMatchObject({result:"no_answer",credit:"returned"});
  });

  it("expires reservations even while another durable handler is blocked",async()=>{
    const f=await fixture();await f.r.updateStatus(f.brief.id,"completed");const v=await final(f);
    // Release the fixture lease so the real worker can claim this summary job.
    await f.r.failDurableJob(v.lease.jobId,v.lease.workerId,"retry_fixture",new Date().toISOString(),new Date().toISOString(),true);
    let release!:()=>void,started!:()=>void;
    const running=new Promise<void>(resolve=>{started=resolve;});
    const gate=new Promise<void>(resolve=>{release=resolve;});
    let clock=Date.now();
    const worker=new DurableJobWorker(f.r,{text_artifact_generation:async()=>{started();await gate;}},()=>undefined,
      {pollIntervalMs:20,now:()=>new Date(clock)});
    try {
      worker.start();await running;
      clock+=360000;
      await expect.poll(async()=>(await f.r.get(f.brief.id))?.brief.lifecycle?.credit,{timeout:3000}).toBe("returned");
      expect((await f.r.get(f.brief.id))?.brief.lifecycle?.assessment?.reason).toBe("deadline");
    } finally {release();await worker.close();}
  });
  it("remembers a failed canonical assessment that precedes the terminal callback",async()=>{
    const f=await fixture(),v=await final(f);
    await f.r.failTextArtifact(v.artifact.id,"TEXT_REQUEST_REJECTED",v.lease,true);
    expect((await f.r.getCreditUsage(f.owner)).transactions.filter(t=>t.type==="call_refund")).toHaveLength(0);
    await f.r.updateStatus(f.brief.id,"completed");
    expect((await f.r.get(f.brief.id))?.brief.lifecycle).toMatchObject({result:"assessment_unavailable",credit:"returned"});
  });

}
