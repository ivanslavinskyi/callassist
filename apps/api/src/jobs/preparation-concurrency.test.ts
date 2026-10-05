import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { defaultPreparationCapacity, defaultPreparationRuntimePolicy } from "@callassist/contracts";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { CallService } from "../call-service";
import { DeterministicBriefCompiler, type BriefCompiler } from "../brief-compiler/brief-compiler";
import { preparationEvaluationCorpus } from "../brief-compiler/preparation-evaluation";
import { approvedCall } from "../voice/voice-test-helpers";
import { DurableJobWorker } from "./durable-job-worker";

describe("multi-user preparation alongside calls", () => {
  it("runs four bounded slots for ten users without recovering or stopping active calls", async () => {
    const repository=new InMemoryCallRepository();
    const calls=await Promise.all(Array.from({length:3},(_,index)=>approvedCall(undefined,repository,"en-GB",`CA-parallel-${index}`)));
    for (let index = 0; index < calls.length; index++) {
      await repository.applyProviderStatus(`CA-parallel-${index}`, "in-progress", "in_progress");
    }
    const recovery=vi.spyOn(repository,"recoverInterruptedCalls");
    let active=0,peak=0,release:()=>void=()=>{};
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const base=new DeterministicBriefCompiler();
    const compiler:BriefCompiler={model:base.model,async compile(input,revision,options){
      active++;peak=Math.max(peak,active);
      try { await gate; options?.signal?.throwIfAborted(); return await base.compile(input,revision); }
      finally { active--; }
    }};
    const errors:unknown[]=[];
    const workers=Array.from({length:2},()=>new CallService(repository,undefined,e=>errors.push(e),undefined,compiler,undefined,undefined,
      {workerRole:"preparation",durableWorkerEnabled:true,preparationSlots:2,liveEventMode:"disabled"}));
    try {
      await Promise.all(workers.map(worker=>worker.initialize()));
      const input=preparationEvaluationCorpus()[0]!.input;
      const preparations=await Promise.all(Array.from({length:10},(_,index)=>workers[index%2]!.prepare(input,randomUUID())));
      await vi.waitFor(()=>expect(active).toBe(4));
      expect(peak).toBe(4);expect(recovery).not.toHaveBeenCalled();
      for(const call of calls) expect((await repository.getLatestAttempt(call.brief.id))?.status).toBe("in_progress");
      release();
      await vi.waitFor(async()=>{const rows=await Promise.all(preparations.map(p=>repository.getAdminCallPreparation(p.id)));
        expect(rows.every(row=>row?.status === "succeeded")).toBe(true);},{timeout:5000});
      expect(errors).toEqual([]);expect(peak).toBe(4);
      for(const call of calls) expect((await repository.getLatestAttempt(call.brief.id))?.status).toBe("in_progress");
    } finally {release();await Promise.all(workers.map(worker=>worker.close()));await Promise.all(calls.map(call=>call.service.close()));}
  });
  it("aborts provider work on lease loss and never reports successful completion", async()=>{
    const repository=new InMemoryCallRepository();
    const prep=await repository.enqueueCallPreparation({userId:randomUUID(),input:preparationEvaluationCorpus()[0]!.input,
      inputFingerprint:"b".repeat(64),idempotencyKey:randomUUID(),now:new Date().toISOString()});
    let signal:AbortSignal|undefined;
    vi.spyOn(repository,"renewDurableJobLease").mockResolvedValue(false);
    const complete=vi.spyOn(repository,"completeDurableJob"), errors=vi.fn();
    const worker=new DurableJobWorker(repository,{brief_compilation:async(_job,lease)=>{
      signal=lease.signal;await new Promise<void>((_,reject)=>lease.signal!.addEventListener("abort",()=>reject(lease.signal!.reason),{once:true}));
    }},errors,{leaseDurationMs:1500});
    await worker.runOnce();
    expect(signal?.aborted).toBe(true);expect(complete).not.toHaveBeenCalled();
    expect((await repository.getAdminCallPreparation(prep.id))?.status).not.toBe("succeeded");await worker.close();
  });
  it("changes policy only for new jobs and keeps the audit on Standard",async()=>{
    const repo=new InMemoryCallRepository(),user=randomUUID(),input=preparationEvaluationCorpus()[0]!.input;
    const before=await repo.enqueueCallPreparation({userId:user,input,inputFingerprint:"a".repeat(64),idempotencyKey:randomUUID(),now:new Date().toISOString()});
    await repo.admitPreparationProfile({profile:{model:"gpt-6-luna",serviceTier:"fast"},expectedRevision:1,reason:"Reviewed synthetic evaluation",
      reportSha256:"a".repeat(64),cases:200,repetitions:2,criticalFailures:0,humanReviewed:true},user);
    await repo.updatePreparationSettings({generation:{model:"gpt-6-luna",serviceTier:"fast"},capacity:defaultPreparationCapacity,expectedRevision:2,reason:"Use evaluated profile"},user);
    const job=await repo.claimDueDurableJob({types:["brief_compilation"],workerId:"snapshot-test",now:new Date().toISOString(),leaseExpiresAt:new Date(Date.now()+120000).toISOString()});
    const work=await repo.claimCallPreparation(before.id,{jobId:job!.id,workerId:"snapshot-test",checkedAt:new Date().toISOString()});
    expect(work.runtimePolicy).toEqual(defaultPreparationRuntimePolicy);
    expect((await repo.getPreparationSettings()).policy.audit.serviceTier).toBe("default");
  });
  it("stops claiming and aborts an unfinished request at the drain bound",async()=>{
    const repository=new InMemoryCallRepository();
    for(let i=0;i<2;i++)await repository.enqueueCallPreparation({userId:randomUUID(),input:preparationEvaluationCorpus()[0]!.input,
      inputFingerprint:"d".repeat(64),idempotencyKey:randomUUID(),now:new Date().toISOString()});
    let signal:AbortSignal|undefined;
    const handler=vi.fn(async(_job,lease)=>{
      signal=lease.signal;
      await new Promise<void>((_,reject)=>lease.signal.addEventListener("abort",()=>reject(lease.signal.reason),{once:true}));
    });
    const worker=new DurableJobWorker(repository,{brief_compilation:handler},()=>{},{drainTimeoutMs:20});
    const running=worker.runOnce();await vi.waitFor(()=>expect(handler).toHaveBeenCalledOnce());
    await worker.close();await running;
    expect(signal?.aborted).toBe(true);expect(handler).toHaveBeenCalledOnce();
    expect((await repository.listDurableJobs()).filter(job=>job.status==='running')).toHaveLength(0);
    expect((await repository.listDurableJobs()).filter(job=>job.status==='queued')).toHaveLength(2);
  });
});
