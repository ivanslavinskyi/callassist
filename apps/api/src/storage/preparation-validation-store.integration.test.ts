import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll,afterEach,beforeAll,describe,expect,it } from "vitest";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "./postgres-call-repository";
import { holisticInput } from "../test-helpers/holistic-candidate";
import { boundedDiagnostic,DIAGNOSTIC_EVENT_BYTES,DIAGNOSTIC_PREPARATION_BYTES } from "./preparation-validation-store";
import type { PreparationDiagnosticInput } from "@callassist/contracts";
describe("private preparation validation evidence",()=>{
  const database=isolatedTestDatabase();let sql:postgres.Sql,repo:PostgresCallRepository;
  beforeAll(async()=>{await database.setup();sql=postgres(database.url,{max:3});repo=new PostgresCallRepository(database.url,Buffer.alloc(32,7));});
  afterEach(async()=>{await sql`UPDATE durable_jobs SET status='cancelled',lease_owner=NULL,leased_at=NULL,lease_expires_at=NULL,completed_at=now() WHERE status IN ('running','queued')`;});
  afterAll(async()=>{await repo?.close();await sql?.end();await database.teardown();});
  const event=(detail:unknown={source:"PRIVATE_SOURCE",candidate:"PRIVATE_CANDIDATE"}):PreparationDiagnosticInput=>({id:randomUUID(),metadata:{version:1,stage:"candidate_validation",code:"OUTPUT_SCHEMA_INVALID",candidateAttempt:1,auditAttempt:0,recoveryUsed:false},detail});
  async function fixture() {
    const userId=randomUUID();
    await sql`INSERT INTO users(id,email,password_hash,phone_e164,first_name,last_name,role,status,ui_locale,created_at,phone_verified_at)
      VALUES(${userId},${`${userId}@example.test`},'test',${`+417${Math.floor(Math.random()*1e8).toString().padStart(8,'0')}`},'Test','Owner','superadmin','active','en',now(),now())`;
    const preparation=await repo.enqueueCallPreparation({userId,idempotencyKey:randomUUID(),inputFingerprint:"a".repeat(64),input:holisticInput,now:new Date().toISOString()});
    const job=(await repo.claimDueDurableJob({types:["brief_compilation"],workerId:randomUUID(),now:new Date().toISOString(),leaseExpiresAt:new Date(Date.now()+120000).toISOString(),useDatabaseTime:true}))!;
    const lease={jobId:job.id,workerId:job.leaseOwner!,generation:job.generation,attemptNumber:job.attemptCount,checkedAt:new Date().toISOString()};
    await repo.claimCallPreparation(preparation.id,lease);
    return {userId,preparation,lease};
  }
  it("retains encrypted evidence independently of failed publication and audits private access",async()=>{
    const f=await fixture(),input=event();await repo.recordPreparationValidation(f.preparation.id,input,f.lease);
    await sql`UPDATE call_preparation_requests SET status='failed',input_ciphertext=NULL,failure_code='BRIEF_COMPILER_RESPONSE_INVALID',completed_at=now() WHERE id=${f.preparation.id}`;
    const [row]=await sql`SELECT * FROM preparation_validation_events WHERE id=${input.id}`;
    expect(JSON.stringify(row)).not.toContain("PRIVATE_SOURCE");
    expect((await repo.listPreparationValidation(f.preparation.id))[0]!.metadata.code).toBe("OUTPUT_SCHEMA_INVALID");
    const evidence=await repo.getPreparationValidationEvidence(f.preparation.id,f.userId,"Investigate failed preparation");
    expect(evidence[0]!.detail).toEqual(input.detail);
    expect((await sql`SELECT count(*)::int AS n FROM preparation_diagnostic_access_events WHERE preparation_id=${f.preparation.id}`)[0]!.n).toBe(1);
  });
  it("bounds concurrent writes, deduplicates events, and prevents stale or cancelled writes",async()=>{
    const f=await fixture(),input=event({text:'Ю'.repeat(400000)});
    await Promise.all(Array.from({length:8},(_,i)=>repo.recordPreparationValidation(f.preparation.id,{...input,id:i?randomUUID():input.id},f.lease)));
    await repo.recordPreparationValidation(f.preparation.id,input,f.lease);
    const rows=await repo.listPreparationValidation(f.preparation.id);expect(rows).toHaveLength(8);
    expect(rows.every(r=>r.metadata.retainedBytes<=DIAGNOSTIC_EVENT_BYTES&&r.metadata.truncated)).toBe(true);
    expect(rows.reduce((n,r)=>n+r.metadata.retainedBytes,0)).toBeLessThanOrEqual(DIAGNOSTIC_PREPARATION_BYTES);
    await repo.recordPreparationValidation(f.preparation.id,event(),{...f.lease,generation:f.lease.generation+1});
    expect(await repo.listPreparationValidation(f.preparation.id)).toHaveLength(8);
    await sql`UPDATE call_preparation_requests SET status='cancelled',input_ciphertext=NULL,completed_at=now() WHERE id=${f.preparation.id}`;
    await repo.recordPreparationValidation(f.preparation.id,event(),f.lease);expect(await repo.listPreparationValidation(f.preparation.id)).toHaveLength(9);
    expect((await repo.getPreparationValidationEvidence(f.preparation.id,f.userId,"Inspect cancellation")).every(r=>r.detail===null)).toBe(true);
  });
  it("purges deleted-account evidence and rejects late writes and access",async()=>{
    const f=await fixture();await repo.recordPreparationValidation(f.preparation.id,event(),f.lease);
    await repo.getPreparationValidationEvidence(f.preparation.id,f.userId,"Investigate evidence");
    await sql`UPDATE users SET status='deleted' WHERE id=${f.userId}`;
    await repo.recordPreparationValidation(f.preparation.id,event(),f.lease);
    expect(await repo.listPreparationValidation(f.preparation.id)).toEqual([]);
    expect(await sql`SELECT id FROM preparation_validation_events WHERE preparation_id=${f.preparation.id}`).toHaveLength(0);
    expect(await sql`SELECT id FROM preparation_diagnostic_access_events WHERE preparation_id=${f.preparation.id}`).toHaveLength(0);
    await expect(repo.getPreparationValidationEvidence(f.preparation.id,f.userId,"Inspect deleted source")).rejects.toMatchObject({code:"CALL_PREPARATION_NOT_FOUND"});
  });
  it("purges linked call evidence and never recreates it after owner deletion",async()=>{
    const f=await fixture();const compilation=await new DeterministicBriefCompiler().compile(holisticInput);
    const call=await repo.create(holisticInput,compilation,f.userId);
    await sql`UPDATE call_preparation_requests SET call_brief_id=${call.id},status='succeeded',input_ciphertext=NULL,completed_at=now() WHERE id=${f.preparation.id}`;
    await repo.recordPreparationValidation(f.preparation.id,event(),f.lease);
    expect(await repo.listPreparationValidation(f.preparation.id)).toHaveLength(1);
    await sql`UPDATE call_briefs SET status='completed' WHERE id=${call.id}`;
    await repo.deleteCallData({callId:call.id,userId:f.userId,requestId:randomUUID(),providerRecordingDisposition:"not_present",deletedAt:new Date().toISOString()});
    await repo.recordPreparationValidation(f.preparation.id,event(),f.lease);
    expect(await repo.listPreparationValidation(f.preparation.id)).toEqual([]);
    expect(await sql`SELECT id FROM preparation_validation_events WHERE preparation_id=${f.preparation.id}`).toHaveLength(0);
  });
  it("expires private details after 30 days",async()=>{
    const f=await fixture();await repo.recordPreparationValidation(f.preparation.id,event(),f.lease);
    await sql`UPDATE preparation_validation_events SET created_at=now()-interval '31 days' WHERE preparation_id=${f.preparation.id}`;
    expect(await repo.listPreparationValidation(f.preparation.id)).toEqual([]);
    await repo.maintainPreparationTelemetry();expect(await sql`SELECT id FROM preparation_validation_events WHERE preparation_id=${f.preparation.id}`).toHaveLength(0);
  });
  it("caps escaped and multibyte plaintext by bytes",()=>{
    for(const text of ['Ю'.repeat(400000),'\u0000'.repeat(400000),'x'.repeat(400000)]) {
      const bounded=boundedDiagnostic(event({text}),DIAGNOSTIC_EVENT_BYTES);
      expect(Buffer.byteLength(JSON.stringify(bounded.detail))).toBeLessThanOrEqual(DIAGNOSTIC_EVENT_BYTES);
      expect(bounded.metadata.truncated).toBe(true);
    }
  });
});
