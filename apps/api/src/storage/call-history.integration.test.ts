import "../config/load-env";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { normalizeCreateCallBriefInput, describeCallTelemetryEvent, callCompilationSchema } from "@callassist/contracts";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { encryptJson } from "../security/encryption";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "./postgres-call-repository";
import { callHistorySuite } from "./call-history.test-suite";
import { originalPlanReview } from "../test-helpers/original-plan-review";

const db = isolatedTestDatabase();
let sql: postgres.Sql, repository: PostgresCallRepository, sequence = 0;
beforeAll(async () => {
  await db.setup(); sql = postgres(db.url, { max: 2 });
  repository = new PostgresCallRepository(db.url, Buffer.alloc(32, 29));
}, 30000);
afterAll(async () => { await repository?.close(); await sql?.end(); await db.teardown(); });
describe("call history PostgreSQL", () => callHistorySuite(async () => {
  const owner = randomUUID(), other = randomUUID();
  for (const id of [owner, other]) await sql`
    INSERT INTO users(id,email,password_hash,phone_e164,phone_verified_at,first_name,last_name,role,status,ui_locale,created_at)
    VALUES(${id},${`${id}@example.com`},'test-only',${`+4173000${String(++sequence).padStart(4, "0")}`},now(),'Nina','Example','user','active','en',now())`;
  return { repository, owner, other };
}));

it('lists archived calls with newer diagnostic and plan versions without admitting them for execution', async () => {
  const owner=randomUUID();
  await sql`INSERT INTO users(id,email,password_hash,phone_e164,phone_verified_at,first_name,last_name,role,status,ui_locale,created_at)
    VALUES(${owner},${`${owner}@example.com`},'test-only',${`+4173000${String(++sequence).padStart(4,'0')}`},now(),'Test','Owner','user','active','en',now())`;
  const input=normalizeCreateCallBriefInput({recipientName:'Archive fixture',phoneNumber:'+41523686688',objective:'Ask office hours',
    assistantProfileId:'sebastian',representedPersonFirstName:'Test',representedPersonLastName:'Owner',locale:'en-GB',allowedFacts:[]});
  const compilation=await new DeterministicBriefCompiler().compile(input);
  const brief=await repository.create(input,compilation,owner);
  const archived={...compilation,compilerVersion:'compiler-future-test',compiledBrief:{...compilation.compiledBrief,schemaVersion:'999'}};
  expect(callCompilationSchema.safeParse(archived).success).toBe(false);
  const ciphertext=encryptJson(archived,Buffer.alloc(32,29));
  // Synthetic future writer fixture, in the disposable database only.
  await sql.begin(async tx=>{
    await tx`SELECT set_config('callassist.encryption_rotation','enabled',true)`;
    await tx`UPDATE call_compilations SET compilation_ciphertext=${ciphertext} WHERE call_brief_id=${brief.id}`;
  });
  for (const name of ['realtime.ready','conversation.task'] as const) {
    const descriptor=describeCallTelemetryEvent(name);
    const metadata=name==='realtime.ready'?{model:'gpt-live-1',transcriptionModel:'gpt-live-1',runtimeVersion:'live-managed-v25'}:
      {runtimeVersion:'live-managed-v25',phase:'decision',revision:1,cause:'future-test'};
    await sql`INSERT INTO call_events(id,call_brief_id,user_id,sequence,schema_version,event_name,source,stage,severity,metadata,idempotency_key,occurred_at)
      SELECT ${randomUUID()},${brief.id},${owner},COALESCE(max(sequence),0)+1,1,${name},${descriptor.source},${descriptor.stage},${descriptor.severity},${sql.json(metadata)},${randomUUID()},now()
      FROM call_events WHERE call_brief_id=${brief.id}`;
  }
  const [latest]=await sql`SELECT max(sequence)::int AS sequence FROM call_events WHERE call_brief_id=${brief.id}`;
  const result=await repository.list({userId:owner,limit:1});
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({id:brief.id,objective:input.objective,displayObjective:null,
    lifecycle:{eventSequence:latest.sequence,substantiveAnswerConfirmed:false,consent:'not_recorded'}});
  expect((await repository.list({userId:randomUUID(),limit:1})).items).toEqual([]);
  const admin = await repository.listAdminCalls({ limit: 100 });
  const inspector = await repository.getAdminCallInspector(brief.id);
  expect(admin.items.find(item => item.id === brief.id)?.lifecycle).toEqual(result.items[0]!.lifecycle);
  expect(inspector.summary.lifecycle).toEqual(result.items[0]!.lifecycle);
  expect(inspector.summary.eventCount - inspector.timeline.length).toBe(2);
  expect(inspector.timeline.some(event => ['realtime.ready', 'conversation.task'].includes(event.payload.name))).toBe(false);
  const facts = await repository.getAdminOperationsFacts('2000-01-01T00:00:00Z', '2099-01-01T00:00:00Z', brief.id);
  expect(facts.connectedCalls).toBe(0);
  await expect(repository.getCallOutcomeMetrics()).resolves.toBeDefined();
  await expect(repository.listCallTelemetryEvents(brief.id)).rejects.toThrow();
  expect(await repository.getAdminCallSensitiveContent(brief.id, owner, 'Archive regression inspection'))
    .toMatchObject({ callBriefId:brief.id, objective:input.objective, transcript:[], finalTranscript:null });
  const [access] = await sql`SELECT count(*)::int AS count FROM call_sensitive_access_events WHERE call_brief_id=${brief.id}`;
  expect(access.count).toBe(1);
  const [stored]=await sql`SELECT compilation_ciphertext FROM call_compilations WHERE call_brief_id=${brief.id}`;
  expect(stored.compilation_ciphertext).toBe(ciphertext);
  await expect(repository.get(brief.id)).rejects.toThrow();
});

it('shows an unsupported assessment as unavailable in all display reads without rewriting evidence or credit', async () => {
  const owner = randomUUID(), key = Buffer.alloc(32, 29);
  await sql`INSERT INTO users(id,email,password_hash,phone_e164,phone_verified_at,first_name,last_name,role,status,ui_locale,created_at)
    VALUES(${owner},${`${owner}@example.com`},'test-only',${`+4173000${String(++sequence).padStart(4,'0')}`},now(),'Test','Owner','user','active','en',now())`;
  await repository.grantSignupCredits(owner);
  const input = normalizeCreateCallBriefInput({ recipientName:'Archive fixture',phoneNumber:'+41523686688',objective:'Ask office hours',
    assistantProfileId:'sebastian',representedPersonFirstName:'Test',representedPersonLastName:'Owner',locale:'en-GB',allowedFacts:[] });
  const brief = await repository.create(input, await new DeterministicBriefCompiler().compile(input), owner);
  await repository.approveCompilation(brief.id, await originalPlanReview(repository, brief.id));
  const { attempt } = await repository.startAttempt(brief.id, { provider:'twilio' });
  const providerCallId = `CA-${randomUUID()}`, providerRecordingId = `RE-${randomUUID()}`;
  await repository.attachProviderCall(attempt.id, providerCallId, 'in-progress');
  const { recording } = await repository.beginRecording(brief.id);
  await repository.attachProviderRecording(recording.id, providerRecordingId, 'in-progress');
  await repository.applyRecordingStatus({ callBriefId:brief.id, recordingId:recording.id, providerCallId,
    providerRecordingId, providerStatus:'completed', durationSeconds:20, channels:2 });
  await repository.claimFinalTranscript(recording.id, 'fixture-transcript');
  await repository.completeFinalTranscript(recording.id, 'The office opens at nine.', []);
  const revision = (await repository.getCurrentTranscriptRevision(brief.id))!;
  const artifactId = randomUUID(), ciphertext = encryptJson({ futureAssessment: true }, key), hash = 'a'.repeat(64);
  // Model a retained revision written by a later release, only in the disposable DB.
  await sql`INSERT INTO call_text_artifacts(id,call_brief_id,kind,compilation_id,transcript_revision_id,source_hash,target_language,generator_version,status,payload_ciphertext)
    VALUES(${artifactId},${brief.id},'call_summary',${attempt.compilationId},${revision.id},${revision.sourceHash},'en','future-fixture','ready',${ciphertext})`;
  await sql`INSERT INTO call_assessments(call_attempt_id,call_brief_id,compilation_id,transcript_revision_id,source_hash,plan_hash,evaluator_version,status,conversation,goal)
    VALUES(${attempt.id},${brief.id},${attempt.compilationId},${revision.id},${revision.sourceHash},${hash},'fixture','ready','confirmed','achieved')`;
  await sql`INSERT INTO call_assessment_revisions(artifact_id,call_brief_id,call_attempt_id,transcript_revision_id,context_hash,evaluator_version,payload_ciphertext)
    VALUES(${artifactId},${brief.id},${attempt.id},${revision.id},${hash},'future-fixture',${ciphertext})`;
  const credits = await repository.getCreditUsage(owner);
  const expected = { status:'unavailable', conversation:null, goal:null, reason:'evidence_uncertain' };
  const history = await repository.list({ userId:owner, limit:100 });
  const admin = await repository.listAdminCalls({ limit:100 });
  const inspector = await repository.getAdminCallInspector(brief.id);
  for (const item of [history.items[0], admin.items.find(item => item.id === brief.id), inspector.summary]) {
    expect(item?.lifecycle?.assessment).toMatchObject(expected);
  }
  const facts = await repository.getAdminOperationsFacts('2000-01-01T00:00:00Z', '2099-01-01T00:00:00Z', brief.id);
  expect(facts.lifecycle?.goals).toMatchObject({ achieved:0, unavailable:1 });
  expect((await repository.getAdminCallSensitiveContent(brief.id, owner, 'Archive assessment regression')).finalTranscript?.text)
    .toBe('The office opens at nine.');
  await sql`UPDATE call_attempts SET native_transcript_capture=${sql.json({ status:'complete' })} WHERE id=${attempt.id}`;
  expect((await repository.getAdminCallSensitiveContent(brief.id, owner, 'Native transcript precedence regression')).finalTranscript)
    .toBeNull(); // Never substitute recording ASR for an absent native transcript.
  await expect(repository.getCallAssessment(brief.id, attempt.id)).rejects.toThrow();
  expect(await repository.getCreditUsage(owner)).toEqual(credits);
  const [stored] = await sql`SELECT payload_ciphertext FROM call_assessment_revisions WHERE artifact_id=${artifactId}`;
  expect(stored.payload_ciphertext).toBe(ciphertext);
});
