import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { normalizeCreateCallBriefInput, type CompilationReviewApprovalInput } from "@callassist/contracts";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import type { CallRepository } from "./call-repository";
import type { DurableJob } from "../jobs/durable-job";

export function callTextRepositorySuite(makeRepository:()=>CallRepository,owner:()=>string) {
  const input=()=>normalizeCreateCallBriefInput({recipientName:"Gemeinde",phoneNumber:"+41523686688",
    objective:"Ask whether my residence form arrived and which documents are missing",assistantProfileId:"sebastian",
    representedPersonFirstName:"Nina",representedPersonLastName:"Keller",locale:"de-CH",audioRetentionDays:0,
    allowLanguageSwitch:false,allowedFacts:["Reference: AB-123"]});
  async function create() {
    const repository=makeRepository(),raw=input();
    const compilation=await new DeterministicBriefCompiler().compile(raw);
    const brief=await repository.create(raw,compilation,owner());
    return {repository,brief,raw,compilation};
  }
  const lease=(job:DurableJob)=>({jobId:job.id,workerId:job.leaseOwner!,checkedAt:new Date().toISOString(),generation:job.generation,attemptNumber:job.attemptCount});
  const claim=(repository:CallRepository)=>repository.claimDueDurableJob({types:["text_artifact_generation"],workerId:randomUUID(),
    now:new Date().toISOString(),leaseExpiresAt:new Date(Date.now()+60000).toISOString()});

  it("requires server review evidence, keeps receipt immutable and binds it to the attempt",async()=>{
    const {repository,brief,compilation}=await create();
    await repository.grantSignupCredits(owner());
    await expect(repository.approveCompilation(brief.id)).rejects.toMatchObject({code:"CALL_REVIEW_REQUIRED"});
    const command:CompilationReviewApprovalInput={revision:compilation.revision,snapshotHash:compilation.snapshotHash,
      review:{mode:"original",language:"de-CH",selectionRevision:1}};
    await repository.approveCompilation(brief.id,command);
    const receipt=await repository.getCurrentReviewReceipt(brief.id);
    await repository.approveCompilation(brief.id,command);
    expect(await repository.getCurrentReviewReceipt(brief.id)).toEqual(receipt);
    await expect(repository.approveCompilation(brief.id,{...command,review:{mode:"original",language:"en",selectionRevision:1}})).rejects.toMatchObject({code:"CALL_REVIEW_CONFLICT"});
    const attempt=await repository.startAttempt(brief.id,{provider:"mock",userId:owner()});
    expect(attempt.attempt.reviewReceiptId).toBe(receipt?.id);
    expect(attempt.attempt.contentLanguage).toBe("en");
    await repository.stop(brief.id);
  });

  it("deduplicates concurrent requests, persists chunks, rejects foreign lease and stale source",async()=>{
    const {repository,brief,raw}=await create();
    const source=await repository.getPlanSource(brief.id);
    const request={callId:brief.id,kind:"plan_review" as const,compilationId:source.compilationId,sourceHash:source.snapshotHash,targetLanguage:"ru" as const,generatorVersion:"test-v1"};
    const [first,second]=await Promise.all([repository.enqueueTextArtifact(request),repository.enqueueTextArtifact(request)]);
    expect(first.id).toBe(second.id);
    const job=await claim(repository);expect(job?.textArtifactId).toBe(first.id);
    await repository.claimTextArtifact(first.id,lease(job!));
    const chunk={fields:[{id:"objective",text:"Проверить получение формы."}]};
    await repository.saveTextArtifactChunk(first.id,0,chunk,lease(job!));
    await expect(repository.getTextArtifactChunks(first.id,{...lease(job!),attemptNumber:99})).rejects.toMatchObject({code:"DURABLE_JOB_LEASE_LOST"});
    expect(await repository.getTextArtifactChunks(first.id,lease(job!))).toEqual([{index:0,payload:chunk}]);
    const ready=await repository.completeTextArtifact(first.id,chunk,lease(job!));
    expect(ready.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await repository.enqueueTextArtifact(request)).id).toBe(first.id);
    await repository.completeDurableJob(job!.id,job!.leaseOwner!,new Date().toISOString());
    const next={...raw,objective:raw.objective+" and ask about office hours"};
    await repository.recompile(brief.id,next,await new DeterministicBriefCompiler().compile(next,2));
    expect((await repository.getTextArtifact(brief.id,first.id))?.status).toBe("stale");
    await expect(repository.enqueueTextArtifact(request)).rejects.toMatchObject({code:"TEXT_ARTIFACT_STALE"});
  });

  it("creates immutable original revisions and summary jobs, then rejects publication after deletion",async()=>{
    const {repository,brief,compilation}=await create();
    await repository.approveCompilation(brief.id,{revision:compilation.revision,snapshotHash:compilation.snapshotHash,review:{mode:"original",language:"de-CH",selectionRevision:1}});
    const attempt=await repository.startAttempt(brief.id,{provider:"twilio"});
    const providerCallId=`CA-${randomUUID()}`,providerRecordingId=`RE-${randomUUID()}`;
    await repository.attachProviderCall(attempt.attempt.id,providerCallId,"in-progress");
    const recording=await repository.beginRecording(brief.id);
    await repository.attachProviderRecording(recording.recording.id,providerRecordingId,"in-progress");
    await repository.applyRecordingStatus({callBriefId:brief.id,recordingId:recording.recording.id,providerCallId,providerRecordingId,providerStatus:"completed",durationSeconds:20,channels:2});
    await repository.claimFinalTranscript(recording.recording.id,"test-model");
    await repository.completeFinalTranscript(recording.recording.id,"The form arrived.",[],undefined,{summaryGeneratorVersion:"test-v1"});
    const first=await repository.getCurrentTranscriptRevision(brief.id);
    expect(first?.segments[0]).toMatchObject({role:"unknown",startSeconds:null,endSeconds:null,text:"The form arrived."});
    expect((await repository.listTextArtifacts(brief.id)).filter(a=>a.kind==="call_summary")).toHaveLength(1);
    const summaryJob=await claim(repository);expect(summaryJob).not.toBeNull();
    await repository.claimTextArtifact(summaryJob!.textArtifactId!,lease(summaryJob!));
    await repository.claimFinalTranscript(recording.recording.id,"test-model",true);
    expect(await repository.getCurrentTranscriptRevision(brief.id)).toBeNull();
    await repository.completeFinalTranscript(recording.recording.id,"The form has NOT arrived.",[]);
    const second=await repository.getCurrentTranscriptRevision(brief.id);
    expect(second?.id).not.toBe(first?.id);
    expect((await repository.getTranscriptRevision(brief.id,first!.id))?.text).toBe("The form arrived.");
    await expect(repository.completeTextArtifact(summaryJob!.textArtifactId!,{answers:[],nextSteps:[],unresolved:[]},lease(summaryJob!))).rejects.toMatchObject({code:"TEXT_ARTIFACT_STALE"});
    await repository.applyProviderStatus(providerCallId,"completed","completed",brief.id);
    await repository.deleteCallData({callId:brief.id,userId:owner(),requestId:randomUUID(),providerRecordingDisposition:"deleted",deletedAt:new Date().toISOString()});
    await expect(repository.getTranscriptRevision(brief.id,first!.id)).rejects.toMatchObject({code:"CALL_NOT_FOUND"});
    await expect(repository.completeTextArtifact(summaryJob!.textArtifactId!,{answers:[],nextSteps:[],unresolved:[]},lease(summaryJob!))).rejects.toMatchObject({code:"CALL_NOT_FOUND"});
    expect((await repository.listDurableJobAttempts(summaryJob!.id)).at(-1)?.outcome).toBe("cancelled");
  });

  it("accepts only a ready exact translation at the current selection revision",async()=>{
    const {repository,brief,compilation}=await create();
    const source=await repository.getPlanSource(brief.id);
    const artifact=await repository.enqueueTextArtifact({callId:brief.id,kind:"plan_review",compilationId:source.compilationId,
      sourceHash:source.snapshotHash,targetLanguage:"en",generatorVersion:"test-v1"});
    const command=(hash:string,selectionRevision:number):CompilationReviewApprovalInput=>({revision:compilation.revision,snapshotHash:compilation.snapshotHash,
      review:{mode:"translated",language:"en",artifactId:artifact.id,artifactHash:hash,selectionRevision}});
    await expect(repository.approveCompilation(brief.id,command("0".repeat(64),1))).rejects.toMatchObject({code:"CALL_REVIEW_STALE"});
    const job=(await claim(repository))!;
    await repository.claimTextArtifact(artifact.id,lease(job));
    const ready=await repository.completeTextArtifact(artifact.id,{fields:[{id:"objective",text:"Ask whether the form arrived."}]},lease(job));
    await repository.completeDurableJob(job.id,job.leaseOwner!,new Date().toISOString());
    await expect(repository.approveCompilation(brief.id,command("0".repeat(64),1))).rejects.toMatchObject({code:"CALL_REVIEW_STALE"});
    await repository.updateContentLanguage(brief.id,"ru",1);
    await expect(repository.approveCompilation(brief.id,command(ready.payloadHash!,1))).rejects.toMatchObject({code:"CALL_REVIEW_STALE"});
    await expect(repository.approveCompilation(brief.id,command(ready.payloadHash!,2))).rejects.toMatchObject({code:"CALL_REVIEW_STALE"});
    await repository.updateContentLanguage(brief.id,"en",2);
    await repository.approveCompilation(brief.id,command(ready.payloadHash!,3));
    const receipt=await repository.getCurrentReviewReceipt(brief.id);
    expect(receipt?.evidence).toEqual(command(ready.payloadHash!,3).review);
    await expect(repository.updateContentLanguage(brief.id,"ru",3)).rejects.toMatchObject({code:"CALL_LANGUAGE_LOCKED"});
    expect(await repository.getCurrentReviewReceipt(brief.id)).toEqual(receipt);
    const attempt=await repository.startAttempt(brief.id,{provider:"mock"});
    expect(attempt.attempt.reviewReceiptId).toBe(receipt?.id);
    expect(attempt.attempt.contentLanguage).toBe("en");
    await repository.stop(brief.id);
  });

  it("keeps provider budget and chunks across bounded retry generations",async()=>{
    const {repository,brief}=await create();
    const source=await repository.getPlanSource(brief.id);
    const artifact=await repository.enqueueTextArtifact({callId:brief.id,kind:"plan_review",compilationId:source.compilationId,
      sourceHash:source.snapshotHash,targetLanguage:"ru",generatorVersion:"test-v1"});
    let previousLease:ReturnType<typeof lease>|null=null;
    for(let generation=1;generation<=3;generation++) {
      const job=(await claim(repository))!;
      const currentLease=lease(job);
      expect(job.generation).toBe(generation);
      await repository.claimTextArtifact(artifact.id,currentLease);
      if(previousLease) await expect(repository.saveTextArtifactChunk(artifact.id,0,{safe:true},previousLease)).rejects.toMatchObject({code:"DURABLE_JOB_LEASE_LOST"});
      if(generation===1) await repository.saveTextArtifactChunk(artifact.id,0,{safe:true},currentLease);
      expect(await repository.getTextArtifactChunks(artifact.id,currentLease)).toEqual([{index:0,payload:{safe:true}}]);
      for(let index=0;index<8;index++) {
        const request={id:randomUUID(),artifactId:artifact.id,provider:"openai" as const,operationType:"text_translation" as const,
          stage:`text.translation.${generation}.${index}`,requestedModel:"test-model",clientRequestId:randomUUID(),startedAt:new Date().toISOString(),maxRequests:24,durableJobGeneration:generation};
        expect(await repository.reserveTextArtifactProviderRequest(request,currentLease)).toBe(true);
        expect(await repository.reserveTextArtifactProviderRequest(request,currentLease)).toBe(true);
      }
      if(generation===3) expect(await repository.reserveTextArtifactProviderRequest({id:randomUUID(),artifactId:artifact.id,provider:"openai",operationType:"text_translation",
        stage:"text.translation.exhausted",requestedModel:"test-model",clientRequestId:randomUUID(),startedAt:new Date().toISOString(),maxRequests:100,durableJobGeneration:3},currentLease)).toBe(false);
      await repository.failTextArtifact(artifact.id,"provider_unavailable",currentLease);
      await repository.failDurableJob(job.id,job.leaseOwner!,"provider_unavailable",new Date().toISOString(),new Date().toISOString(),false);
      previousLease=currentLease;
      if(generation<3) expect((await repository.retryTextArtifact(brief.id,artifact.id)).status).toBe("queued");
    }
    await expect(repository.retryTextArtifact(brief.id,artifact.id)).rejects.toMatchObject({code:"TEXT_ARTIFACT_NOT_RETRYABLE"});
  });
}
