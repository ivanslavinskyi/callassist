import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { defaultPreparationCapacity } from "@callassist/contracts";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "./postgres-call-repository";
import { preparationEvaluationCorpus } from "../brief-compiler/preparation-evaluation";
import { PreparationRequestDiagnostics } from "../brief-compiler/request-diagnostics";
import type { CompleteProviderOperationInput } from "./call-repository";

describe("distributed provider admission and diagnostic retention",()=>{
  const database=isolatedTestDatabase();
  let sql:postgres.Sql, first:PostgresCallRepository, second:PostgresCallRepository;
  beforeAll(async()=>{await database.setup();sql=postgres(database.url,{max:3});first=new PostgresCallRepository(database.url,Buffer.alloc(32,7));second=new PostgresCallRepository(database.url,Buffer.alloc(32,7));});
  afterEach(async()=>{
    await sql`DELETE FROM preparation_provider_permits`;await sql`DELETE FROM preparation_provider_admissions`;
    await sql`UPDATE preparation_provider_cooldown SET until_at='epoch'`;
    await sql`UPDATE preparation_settings SET capacity=${sql.json(defaultPreparationCapacity)}`;
    await sql`UPDATE durable_jobs SET status='cancelled',lease_owner=NULL,leased_at=NULL,lease_expires_at=NULL,completed_at=now() WHERE status IN ('queued','running')`;
  });
  afterAll(async()=>{await Promise.all([first?.close(),second?.close(),sql?.end()]);await database.teardown();});
  async function fixture() {
    const userId=randomUUID();
    await sql`INSERT INTO users(id,email,password_hash,phone_e164,first_name,last_name,role,status,ui_locale,created_at,phone_verified_at)
      VALUES(${userId},${`${userId}@example.test`},'test',${`+417${Date.now().toString().slice(-8)}`},'Test','Owner','user','active','en',now(),now())`;
    const preparation=await first.enqueueCallPreparation({userId,idempotencyKey:randomUUID(),inputFingerprint:"a".repeat(64),input:preparationEvaluationCorpus()[0]!.input,now:new Date().toISOString()});
    const job=(await first.claimDueDurableJob({types:["brief_compilation"],workerId:randomUUID(),now:new Date().toISOString(),leaseExpiresAt:new Date(Date.now()+120000).toISOString(),useDatabaseTime:true}))!;
    const lease={jobId:job.id,workerId:job.leaseOwner!,generation:job.generation,attemptNumber:job.attemptCount,checkedAt:new Date().toISOString()};
    await first.claimCallPreparation(preparation.id,lease);
    const request=(estimatedTokens=100)=>{const id=randomUUID();return {id,preparationId:preparation.id,provider:"openai" as const,operationType:"brief_compilation" as const,
      requestedModel:"gpt-5.6",requestedServiceTier:"default",estimatedTokens,stage:"compilation" as const,clientRequestId:id,startedAt:new Date().toISOString(),maxRequests:12,durableJobGeneration:job.generation,
      requestMetadata:{repairKind:"none" as const,repairNumber:0,transportAttempt:1,timeoutMs:35000,remainingMs:120000}};};
    return {userId,preparation,job,lease,request};
  }
  const terminal=(operationId:string,overrides:Partial<CompleteProviderOperationInput>={}):CompleteProviderOperationInput=>({operationId,outcome:"succeeded",providerRequestId:null,providerResponseId:null,
    providerModel:"gpt-5.6",statusCode:200,completedAt:new Date().toISOString(),durationMs:1,errorCode:null,usage:null,...overrides});
  it.each(["network_error", "invalid_response"] as const)("atomically limits two pools, preserves idempotency, and keeps cancelled remote work reserved: %s",async outcome=>{
    const f=await fixture();await sql`UPDATE preparation_settings SET capacity=jsonb_set(capacity,'{providerSlots}','2')`;
    const requests=Array.from({length:6},()=>f.request());
    const results=await Promise.allSettled(requests.map((request,i)=>(i%2 ? first : second).reserveCallPreparationProviderRequest(request,f.lease)));
    const accepted=requests.filter((_,i)=>results[i]!.status==='fulfilled');expect(accepted).toHaveLength(2);
    expect(await second.reserveCallPreparationProviderRequest(accepted[0]!,f.lease)).toBe(true);
    await first.completeProviderOperation(terminal(accepted[0]!.id,{outcome,statusCode:outcome === "network_error" ? null : 200,
      errorCode:outcome === "invalid_response" ? "OPENAI_STREAM_PADDING" : null}));
    await expect(second.reserveCallPreparationProviderRequest(f.request(),f.lease)).rejects.toMatchObject({code:"PREPARATION_PROVIDER_BUSY"});
    await second.completeProviderOperation(terminal(accepted[1]!.id));
    const next=f.request();expect(await first.reserveCallPreparationProviderRequest(next,f.lease)).toBe(true);
    await first.completeProviderOperation(terminal(next.id,{outcome:"provider_error",statusCode:429,retryAfterMs:5000}));
    await expect(second.reserveCallPreparationProviderRequest(f.request(),f.lease)).rejects.toMatchObject({code:"PREPARATION_PROVIDER_BUSY",retryAfterMs:expect.any(Number)});
    expect((await sql`SELECT provider_request_count FROM call_preparation_requests WHERE id=${f.preparation.id}`)[0]!.provider_request_count).toBe(3);
  });
  it("shares rolling request/token budgets between models and tiers while retaining the voice reserve",async()=>{
    const f=await fixture();await sql`UPDATE preparation_settings SET capacity=capacity || '{"providerRequestsPerMinute":4,"providerTokensPerMinute":400000,"voiceReservePercent":25}'::jsonb`;
    for(let index=0;index<2;index++){const request={...f.request(120000),requestedServiceTier:index ? "fast" : "default",requestedModel:index ? "gpt-6-luna" : "gpt-5.6"};
      expect(await first.reserveCallPreparationProviderRequest(request,f.lease)).toBe(true);await first.completeProviderOperation(terminal(request.id));}
    await expect(second.reserveCallPreparationProviderRequest(f.request(120000),f.lease)).rejects.toMatchObject({code:"PREPARATION_PROVIDER_BUSY"});
    const third=f.request(100);expect(await second.reserveCallPreparationProviderRequest(third,f.lease)).toBe(true);await second.completeProviderOperation(terminal(third.id));
    await expect(first.reserveCallPreparationProviderRequest(f.request(100),f.lease)).rejects.toMatchObject({code:"PREPARATION_PROVIDER_BUSY"});
    await sql`UPDATE preparation_provider_admissions SET admitted_at=clock_timestamp()-interval '61 seconds'`;
    expect(await second.reserveCallPreparationProviderRequest(f.request(100),f.lease)).toBe(true);
  });
  it("purges account diagnostics and refuses late metadata while retaining terminal accounting",async()=>{
    const f=await fixture(),request=f.request();await first.reserveCallPreparationProviderRequest(request,f.lease);
    const checkpoint={version:1 as const,kind:"first_event" as const,elapsedMs:1,providerRequestId:null,providerResponseId:null,actualServiceTier:"default" as const};
    await first.recordPreparationCheckpoint(request.id,checkpoint);
    expect((await first.getPreparationDiagnostics(f.preparation.id)).timeline[0]!.checkpoints).toHaveLength(1);
    await sql`UPDATE users SET status='deleted' WHERE id=${f.userId}`;
    await second.recordPreparationCheckpoint(request.id,{...checkpoint,kind:"terminal"});
    await second.completeProviderOperation(terminal(request.id,{diagnostics:new PreparationRequestDiagnostics(0,35000,10).finish()}));
    const [row]=await sql`SELECT o.request_metadata,r.response_metadata,r.outcome FROM provider_operations o JOIN provider_operation_results r ON r.operation_id=o.id WHERE o.id=${request.id}`;
    expect(row).toMatchObject({request_metadata:null,response_metadata:null,outcome:"succeeded"});
    expect((await sql`SELECT * FROM preparation_request_checkpoints WHERE operation_id=${request.id}`)).toHaveLength(0);
  });
  it("retains only anonymous aggregates after detail expiry without changing accounting",async()=>{
    const f=await fixture(),request={...f.request(),startedAt:new Date(Date.now()-31*86400000).toISOString()};
    await first.reserveCallPreparationProviderRequest(request,f.lease);
    await first.completeProviderOperation(terminal(request.id,{diagnostics:new PreparationRequestDiagnostics(0,35000,10).finish()}));
    await first.maintainPreparationTelemetry();
    const [row]=await sql`SELECT o.request_metadata,r.response_metadata,r.outcome FROM provider_operations o JOIN provider_operation_results r ON r.operation_id=o.id WHERE o.id=${request.id}`;
    expect(row).toMatchObject({request_metadata:null,response_metadata:null,outcome:"succeeded"});
    await expect(sql`UPDATE provider_operation_results SET outcome='network_error' WHERE operation_id=${request.id}`).rejects.toThrow("append-only");
  });
});
