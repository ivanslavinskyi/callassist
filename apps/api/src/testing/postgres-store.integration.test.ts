import { beforeAll,afterAll,it,expect } from "vitest";
import { randomUUID } from "node:crypto";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { buildAdminCostOverview } from "../admin-operations";
import { unavailableOperationalCostPolicy } from "../config/operational-cost-policy";
import postgres from "postgres";
import { normalizeCreateCallBriefInput } from "@callassist/contracts";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresTestingStore } from "./postgres-store";
import { PostgresAuthRepository } from "../auth/postgres-auth-repository";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { decryptJson, parseDataEncryptionKeyring } from "../security/encryption";
import { backfillObjectives } from "../db/backfill-objectives";
const fixture=isolatedTestDatabase(),key=Buffer.alloc(32,7);
const keyring=parseDataEncryptionKeyring({DATA_ENCRYPTION_KEY:key.toString('base64')});
let sql:postgres.Sql, store:PostgresTestingStore,auth:PostgresAuthRepository,calls:PostgresCallRepository,sa:string,tester:string;
beforeAll(async()=>{
  await fixture.setup();sql=postgres(fixture.url,{max:2,onnotice:()=>undefined});store=new PostgresTestingStore(fixture.url,key);
  auth=new PostgresAuthRepository(fixture.url,true);calls=new PostgresCallRepository(fixture.url,keyring);
  sa=(await auth.createUser({email:'scenario-admin@example.test',phoneE164:'+41710000781',firstName:'Test',lastName:'Admin',passwordHash:'test-only',uiLocale:'en'})).id;
  tester=(await auth.createUser({email:'scenario-user@example.test',phoneE164:'+41710000782',firstName:'Test',lastName:'User',passwordHash:'test-only',uiLocale:'en'})).id;
  await sql`UPDATE users SET role='superadmin',phone_verified_at=now() WHERE id=${sa}`;
});
afterAll(async()=>{await store?.close();await auth?.close();await calls?.close();await sql?.end();await fixture.teardown();});
it('persists encrypted revisions, rejects stale/concurrent edits and enforces revocation',async()=>{
  expect(await store.access(sa)).toMatchObject({enabled:true,byRole:true});
  const input={title:'Appointment',objective:'Ask about the price, then arrange an appointment if suitable.',locale:'en' as const,status:'active' as const,sortOrder:0};
  const first=await store.save(sa,null,input,0);
  await store.setAccess(sa,tester,true,0);expect(await store.list(tester)).toHaveLength(1);
  const writes=await Promise.allSettled([store.save(sa,first.id,{...input,title:'First edit'},1),store.save(sa,first.id,{...input,title:'Other edit'},1)]);
  expect(writes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const [row]=await sql`SELECT payload_ciphertext FROM test_scenario_revisions WHERE scenario_id=${first.id} AND revision=1`;
  expect(row!.payload_ciphertext).not.toContain(input.objective);expect(decryptJson(row!.payload_ciphertext,key)).toMatchObject(input);
  expect(await store.attribution(tester,input.objective,{id:first.id,revision:1})).toMatchObject({tester:true,objectiveModified:false});
  await store.setAccess(sa,tester,false,1);await expect(store.list(tester)).rejects.toMatchObject({status:403});
  await expect(store.save(tester,null,input,0)).rejects.toMatchObject({status:403});
  await sql`UPDATE users SET status='deleted' WHERE id=${tester}`;
  expect(await sql`SELECT * FROM testing_access WHERE user_id=${tester}`).toHaveLength(0);
});
it('encrypts the objective projection, backfills old rows idempotently and redacts on deletion',async()=>{
  const input=normalizeCreateCallBriefInput({recipientName:'Synthetic Office',phoneNumber:'+41710000783',objective:'Ask office hours for member 001234567.',assistantProfileId:'sebastian',representedPersonFirstName:'Nina',representedPersonLastName:'Keller',locale:'en-GB',allowLanguageSwitch:false,allowedFacts:[]});
  const brief=await calls.create(input,await new DeterministicBriefCompiler().compile(input));
  const [row]=await sql`SELECT objective,objective_ciphertext FROM call_briefs WHERE id=${brief.id}`;
  expect(row!.objective).toBe('Encrypted task');expect(decryptJson(row!.objective_ciphertext,keyring)).toBe(brief.objective);
  expect((await calls.get(brief.id))!.brief.objective).toBe(brief.objective);
  await sql`UPDATE call_briefs SET objective=${brief.objective},objective_ciphertext=NULL WHERE id=${brief.id}`;
  const env={DATABASE_URL:fixture.url,DATA_ENCRYPTION_KEY:key.toString('base64')};
  expect(await backfillObjectives([],env)).toMatchObject({candidates:1,updated:0});
  expect(await backfillObjectives(['--execute'],env)).toMatchObject({updated:1});
  expect(await backfillObjectives(['--execute'],env)).toMatchObject({updated:0});
  expect((await calls.get(brief.id))!.brief.objective).toBe(brief.objective);
  await sql`UPDATE call_briefs SET data_deleted_at=now() WHERE id=${brief.id}`;
  const [deleted]=await sql`SELECT objective_ciphertext FROM call_briefs WHERE id=${brief.id}`;expect(deleted!.objective_ciphertext).toBeNull();
});
it('pins retention to the attempt and keeps its first deletion deadline across callbacks',async()=>{
  const input=normalizeCreateCallBriefInput({recipientName:'Synthetic Office',phoneNumber:'+41710000783',objective:'Ask for the opening hours',assistantProfileId:'anna',representedPersonFirstName:'Nina',representedPersonLastName:'Keller',locale:'en-GB',allowLanguageSwitch:false,allowedFacts:[],audioRetentionDays:7});
  const brief=await calls.create(input,await new DeterministicBriefCompiler().compile(input),sa);
  await calls.approveCompilation(brief.id,await originalPlanReview(calls,brief.id));
  const {attempt}=await calls.startAttempt(brief.id,{provider:'twilio'});
  const providerCallId='CA-'+brief.id,providerRecordingId='RE-'+brief.id;
  await calls.attachProviderCall(attempt.id,providerCallId,'in-progress');
  const recording=(await calls.beginRecording(brief.id,{method:'voice',decision:'affirmative',locale:'en-GB'})).recording;
  await calls.attachProviderRecording(recording.id,providerRecordingId,'in-progress');
  await sql`UPDATE call_briefs SET audio_retention_days=30 WHERE id=${brief.id}`;
  const callback={callBriefId:brief.id,recordingId:recording.id,providerCallId,providerRecordingId,providerStatus:'completed' as const,durationSeconds:20,channels:2};
  const before=Date.now();await calls.applyRecordingStatus(callback);
  const first=(await calls.get(brief.id))!.recording!.deleteAfter!;
  expect(Date.parse(first)-before).toBeGreaterThanOrEqual(7*86400000-1000);
  expect(Date.parse(first)-before).toBeLessThan(7*86400000+5000);
  await calls.applyRecordingStatus(callback);expect((await calls.get(brief.id))!.recording!.deleteAfter).toBe(first);
  // Classification changes grouping only, never model usage or pricing.
  const op=randomUUID(),preparation=randomUUID();
  await sql`INSERT INTO call_preparation_requests(id,user_id,idempotency_key,input_fingerprint,status,call_brief_id,completed_at)
    VALUES(${preparation},${sa},${randomUUID()},${'a'.repeat(64)},'succeeded',${brief.id},now())`;
  await sql`INSERT INTO provider_operations(id,provider,operation_type,stage,requested_model,client_request_id,call_brief_id,started_at)
    VALUES(${op},'openai','brief_compilation','test','gpt-5.6',${op},${brief.id},now())`;
  await sql`INSERT INTO provider_usage_records(id,operation_id,schema_version,request_count,input_text_tokens,output_text_tokens,raw_usage,observed_at)
    VALUES(${randomUUID()},${op},1,1,1000,100,'{}',now())`;
  const costs=async()=>buildAdminCostOverview(await calls.getAdminOperationsFacts('2020-01-01T00:00:00Z','2100-01-01T00:00:00Z',brief.id),unavailableOperationalCostPolicy);
  const old=await costs();await store.recordPreparation(preparation,await store.attribution(sa,input.objective));
  const current=await costs();
  expect(current.providerUsage.calculatedUsdMicros).toBe(old.providerUsage.calculatedUsdMicros);
  expect(current.providerUsage.records.find(r=>r.id===op)?.testingAttribution).toMatchObject({tester:true,byRole:true});
  expect(current.providerUsage.testingCohorts?.find(c=>c.cohort==='tester'&&c.costBasis==='usage_estimate')?.amountMicros).toBe(old.providerUsage.calculatedUsdMicros);
});
