import "../config/load-env";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { normalizeCreateCallBriefInput, type CallAssessmentDecision } from "@callassist/contracts";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { PostgresAuthRepository } from "../auth/postgres-auth-repository";
import { AuthService } from "../auth/auth-service";
import { MockVerificationProvider } from "../auth/verification-provider";
import { MockEmailProvider,EmailDeliveryError } from "../auth/email-provider";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { SuperadminNotifications } from "./superadmin-notifications";
import { decryptJson } from "../security/encryption";

const db=isolatedTestDatabase(),key=Buffer.alloc(32,22);
let sql:postgres.Sql,calls:PostgresCallRepository,authRepository:PostgresAuthRepository,operator:string,now:Date,email:MockEmailProvider;
let service:SuperadminNotifications,sequence=0;
const closers:SuperadminNotifications[]=[];
beforeAll(async()=>{await db.setup();sql=postgres(db.url,{max:6});calls=new PostgresCallRepository(db.url,key);authRepository=new PostgresAuthRepository(db.url);},30000);
afterAll(async()=>{await calls?.close();await authRepository?.close();await sql?.end();await db.teardown();});
afterEach(async()=>{vi.restoreAllMocks();for(const item of closers.splice(0)) await item.close();});
function worker() {
  const result=new SuperadminNotifications(db.url,key,email,{siteUrl:"https://example.test"},calls,{now:()=>now,onError:error=>{throw error;}});
  closers.push(result);return result;
}
async function user(role="user",verified=false,locale="de") {
  const id=randomUUID();
  await sql`INSERT INTO users(id,email,password_hash,phone_e164,phone_verified_at,email_verified_at,first_name,last_name,role,status,ui_locale,created_at)
    VALUES(${id},${`${id}@example.test`},'test-only',${`+417400${String(++sequence).padStart(5,"0")}`},${verified?new Date():null},${verified?new Date():null},'Nina','Example',${role},'active',${locale},now())`;
  return id;
}
async function configure(settings:Partial<{enabled:boolean;registrations:boolean;calls:boolean;recipientUserIds:string[]}>) {
  const view=await service.getView();
  await service.update({settings:{...view.settings,...settings},expectedRevision:view.revision,reason:"Fixture settings"},operator);
}
beforeEach(async()=>{
  now=new Date(Date.now()+60_000);email=new MockEmailProvider();
  await sql`UPDATE superadmin_notification_settings SET settings='{"enabled":false,"registrations":true,"calls":true,"recipientUserIds":[]}',revision=revision+1`;
  await sql`TRUNCATE superadmin_notification_audit,superadmin_notifications`;
  operator=await user("superadmin",true,"en");service=worker();await configure({enabled:true,recipientUserIds:[operator]});
});
async function confirm(id:string) { return authRepository.markPhoneVerified(id,new Date().toISOString()); }
async function callFixture(connected=true) {
  const owner=await user("user",true);await calls.grantSignupCredits(owner);
  const input=normalizeCreateCallBriefInput({recipientName:"Office",phoneNumber:"+41523686688",objective:"Ask when the office opens",assistantProfileId:"sebastian",
    representedPersonFirstName:"Nina",representedPersonLastName:"Example",locale:"en-GB",allowLanguageSwitch:false,allowedFacts:[]});
  const compilation=await new DeterministicBriefCompiler().compile(input),brief=await calls.create(input,compilation,owner);
  await calls.approveCompilation(brief.id,await originalPlanReview(calls,brief.id));
  const {attempt}=await calls.startAttempt(brief.id,{userId:owner,provider:"twilio"});
  await calls.attachProviderCall(attempt.id,`CA-${attempt.id}`,connected ? "in-progress" : "initiated");
  return {owner,brief,attempt,compilation};
}
async function rows() {return sql`SELECT * FROM superadmin_notifications ORDER BY created_at,id`;}
describe("durable superadmin notifications",()=>{
  it.each([
    ["en", "Email verified: No"],
    ["de", "E-Mail bestätigt: Nein"]
  ])("enqueues once after successful SMS verification and uses recipient locale %s",async(locale,verificationText)=>{
    await sql`UPDATE users SET ui_locale=${locale} WHERE id=${operator}`;
    const id=await user();const record=await authRepository.findUserByEmail(`${id}@example.test`);
    const sms=new MockVerificationProvider("123456");await sms.send(record!.phoneE164);
    const auth=new AuthService({repository:authRepository,verificationProvider:sms,signupCreditGranter:calls});
    await expect(auth.verifyPhone({email:record!.email,code:"999999"},{ip:"127.0.0.1"})).rejects.toThrow();
    expect(await rows()).toHaveLength(0);
    const results=await Promise.allSettled([1,2].map(()=>auth.verifyPhone({email:record!.email,code:"123456"},{ip:"127.0.0.1"})));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
    await service.tick();expect(email.adminMessages).toHaveLength(1);
    expect(email.adminMessages[0]!.content.text).toContain(verificationText);
    expect(email.adminMessages[0]!.content.html).toContain(`lang="${locale}"`);
    await sql`UPDATE users SET phone_verified_at=NULL WHERE id=${id}`;await confirm(id);
    await service.tick();expect(email.adminMessages).toHaveLength(1);
  });
  it("rolls back notification creation with the business transaction",async()=>{
    const id=await user();
    await expect(sql.begin(async tx=>{await tx`UPDATE users SET phone_verified_at=now() WHERE id=${id}`;throw Error("rollback");})).rejects.toThrow("rollback");
    expect(await rows()).toHaveLength(0);
    await confirm(id);expect(await rows()).toHaveLength(1);
  });
  it("cancels queued work on disable and does not replay disabled events after enabling",async()=>{
    await confirm(await user());await configure({registrations:false});
    await confirm(await user());await configure({registrations:true});await service.tick();
    expect(email.adminMessages).toHaveLength(0);expect((await rows())[0]!.status).toBe("cancelled");
    await confirm(await user());await service.tick();expect(email.adminMessages).toHaveLength(1);
  });
  it("freezes encrypted payload and idempotency key across uncertain delivery and worker restart",async()=>{
    const sender=vi.spyOn(email,"sendAdminNotification").mockRejectedValueOnce(new EmailDeliveryError(true));
    await confirm(await user());await service.tick();
    const [row]=await rows();expect(row!.status).toBe("queued");expect(row!.payload_ciphertext).not.toContain("example.test");
    const frozen=decryptJson(row!.payload_ciphertext,key);expect(frozen).toEqual(sender.mock.calls[0]![0]);
    now=new Date(now.getTime()+60_000);await worker().tick();
    expect(sender.mock.calls[1]![0]).toEqual(sender.mock.calls[0]![0]);
    expect((await rows())[0]).toMatchObject({status:"accepted",send_attempts:2,payload_ciphertext:null});
  });
  it("allows only one of two workers to dispatch an event",async()=>{
    await confirm(await user());await Promise.all([service.tick(),worker().tick()]);
    expect(email.adminMessages).toHaveLength(1);expect((await rows())[0]!.send_attempts).toBe(1);
  });
  it("serializes disabling against concurrent event creation",async()=>{
    const id=await user();
    await Promise.all([confirm(id),configure({registrations:false})]);
    await configure({registrations:true});await service.tick();
    expect(email.adminMessages).toHaveLength(0);
    expect((await rows()).every(row=>row.status==='cancelled')).toBe(true);
  });
  it.each(["role","email","deletion"])("cancels pending recipient access after %s changes",async(change)=>{
    await confirm(await user());
    if(change==='role') await sql`UPDATE users SET role='admin' WHERE id=${operator}`;
    else if(change==='email') await sql`UPDATE users SET email='changed@example.test' WHERE id=${operator}`;
    else await sql`UPDATE users SET status='deleted' WHERE id=${operator}`;
    await service.tick();expect(email.adminMessages).toHaveLength(0);expect((await rows())[0]!.status).toBe("cancelled");
  });
  it("rejects stale settings and unverified or non-superadmin recipients",async()=>{
    const view=await service.getView();await configure({calls:false});
    await expect(service.update({settings:view.settings,expectedRevision:view.revision,reason:"Stale fixture"},operator)).rejects.toMatchObject({code:"NOTIFICATION_SETTINGS_STALE"});
    await expect(configure({recipientUserIds:[await user("admin",true)]})).rejects.toMatchObject({code:"NOTIFICATION_RECIPIENT_INVALID"});
    await expect(configure({recipientUserIds:[await user("superadmin",false)]})).rejects.toMatchObject({code:"NOTIFICATION_RECIPIENT_INVALID"});
  });
  it("does not retry rejected mail or exceed the deduplication window",async()=>{
    vi.spyOn(email,"sendAdminNotification").mockRejectedValue(new EmailDeliveryError(false));
    await confirm(await user());await service.tick();expect((await rows())[0]!.status).toBe("failed");
    vi.restoreAllMocks();await confirm(await user());
    await sql`UPDATE superadmin_notifications SET first_send_at=${new Date(now.getTime()-21*3600_000)} WHERE status='queued'`;
    await service.tick();expect(email.adminMessages).toHaveLength(0);
    expect((await rows()).some(r=>r.last_error_code==='DELIVERY_WINDOW_EXPIRED')).toBe(true);
  });
  it("recovers an expired worker lease",async()=>{
    await confirm(await user());await sql`UPDATE superadmin_notifications SET status='processing',lease_owner=${randomUUID()},lease_until=${new Date(now.getTime()-1000)}`;
    await service.tick();expect(email.adminMessages).toHaveLength(1);
  });
  it("waits for analysis, bounds the wait and ignores repeated terminal callbacks",async()=>{
    const f=await callFixture();await calls.beginRecording(f.brief.id);await calls.updateStatus(f.brief.id,"completed");
    await service.tick();expect(email.adminMessages).toHaveLength(0);
    await calls.updateStatus(f.brief.id,"completed");expect(await rows()).toHaveLength(1);
    now=new Date(now.getTime()+5*60_000);await service.tick();
    expect(email.adminMessages).toHaveLength(1);expect(email.adminMessages[0]!.content.text).toContain("AI assessment: Unavailable");
    expect(email.adminMessages[0]!.content.text).toContain(f.attempt.id);
  });
  it.each([
    ["en", "Status: No answer", "Not assessed (no recording consent)", "Connected duration: 0 seconds"],
    ["de", "Status: Keine Antwort", "Nicht bewertet (keine Zustimmung zur Aufnahme)", "Verbindungsdauer: 0 Sekunden"]
  ])("reports no-answer attempts in recipient locale %s without inventing an LLM failure or a connection",async(locale,status,assessment,duration)=>{
    await sql`UPDATE users SET ui_locale=${locale} WHERE id=${operator}`;
    const f=await callFixture(false);
    await calls.applyProviderStatus(`CA-${f.attempt.id}`,"no-answer","failed",f.brief.id);
    await service.tick();expect(email.adminMessages).toHaveLength(1);
    const text=email.adminMessages[0]!.content.text;
    expect(text).toContain(status);expect(text).toContain(assessment);
    expect(text).toContain(duration);
    expect(email.adminMessages[0]!.content.html).toContain(`lang="${locale}"`);
  });
  it("suppresses reports when source data is deleted",async()=>{
    const id=await user();await confirm(id);await sql`UPDATE users SET status='deleted' WHERE id=${id}`;
    await service.tick();expect(email.adminMessages).toHaveLength(0);
    const f=await callFixture();await calls.updateStatus(f.brief.id,"failed");
    await sql`UPDATE call_briefs SET data_deleted_at=now() WHERE id=${f.brief.id}`;
    now=new Date(now.getTime()+6*60_000);await service.tick();expect(email.adminMessages).toHaveLength(0);
    expect((await rows()).every(r=>r.status==='cancelled' && r.payload_ciphertext===null)).toBe(true);
  });
  it("uses the canonical ready assessment and preserves original-language summary text",async()=>{
    const f=await callFixture();
    const {recording}=await calls.beginRecording(f.brief.id);
    await calls.attachProviderRecording(recording.id,`RE-${recording.id}`,"in-progress");
    await calls.applyRecordingStatus({callBriefId:f.brief.id,recordingId:recording.id,providerCallId:`CA-${f.attempt.id}`,
      providerRecordingId:`RE-${recording.id}`,providerStatus:"completed",durationSeconds:35,channels:2});
    await calls.claimFinalTranscript(recording.id,"fixture");
    await calls.completeFinalTranscript(recording.id,"When do you open? Завтра в 10:00.",[
      {role:"assistant",text:"When do you open?",startSeconds:1,endSeconds:3},
      {role:"recipient",text:"Завтра в 10:00.",startSeconds:4,endSeconds:6}]);
    const revision=(await calls.getCurrentTranscriptRevision(f.brief.id))!;
    const answerId=revision.segments[1]!.id;
    const decision:CallAssessmentDecision={conversation:{status:"confirmed",category:"task_answer",questionSegmentId:revision.segments[0]!.id,
      answerSegmentId:answerId,answerQuote:"Завтра в 10:00."},goal:{status:"achieved",sourceSegmentIds:[answerId]},
      criteria:f.compilation.compiledBrief!.successCriteria.map((_,i)=>({id:`criterion.${i}`,status:"achieved",sourceSegmentIds:[answerId]}))};
    const artifact=await calls.enqueueTextArtifact({callId:f.brief.id,kind:"call_summary",compilationId:f.attempt.compilationId!,transcriptRevisionId:revision.id,
      sourceHash:revision.sourceHash,targetLanguage:f.attempt.contentLanguage??"en",generatorVersion:"summary-v3:test:openai:fixture"});
    const job=(await calls.claimDueDurableJob({types:["text_artifact_generation"],workerId:randomUUID(),now:new Date().toISOString(),leaseExpiresAt:new Date(Date.now()+60_000).toISOString()}))!;
    const lease={jobId:job.id,workerId:job.leaseOwner!,checkedAt:new Date().toISOString(),generation:job.generation,attemptNumber:job.attemptCount};
    await calls.claimTextArtifact(artifact.id,lease);
    await calls.completeTextArtifact(artifact.id,{schemaVersion:2,assessment:decision,
      overview:[{label:"Итог",text:"Завтра в 10:00.",findingIds:["hours"]}],
      findings:[{id:"hours",label:"Время",text:"Завтра в 10:00.",certainty:"reported",sourceSegmentIds:[answerId]}],nextSteps:[],unresolved:[]},lease);
    await calls.updateStatus(f.brief.id,"completed");await service.tick();
    expect(email.adminMessages).toHaveLength(1);
    expect(email.adminMessages[0]!.content.text).toContain("Goal: Achieved");
    expect(email.adminMessages[0]!.content.text).toContain("Итог: Завтра в 10:00.");
    expect(email.adminMessages[0]!.content.html).toContain('lang="en"');
  });
  it("separates two attempt costs and shared preparation, pricing each request once",async()=>{
    const f=await callFixture();await calls.updateStatus(f.brief.id,"failed");
    await calls.updateStatus(f.brief.id,"ready");
    const {attempt:second}=await calls.startAttempt(f.brief.id,{userId:f.owner,provider:"twilio"});
    async function usage(attemptId:string|null,type:string,input:number,output:number) {
      const id=randomUUID();
      await sql`INSERT INTO provider_operations(id,provider,operation_type,stage,requested_model,client_request_id,call_brief_id,call_attempt_id,started_at)
        VALUES(${id},'openai',${type},'notification_fixture','gpt-5.6',${id},${f.brief.id},${attemptId},now())`;
      await sql`INSERT INTO provider_usage_records(id,operation_id,schema_version,request_count,input_text_tokens,cached_input_text_tokens,cache_write_input_text_tokens,
        output_text_tokens,raw_usage,observed_at) VALUES(${randomUUID()},${id},1,1,${input},0,0,${output},'{}',now())`;
    }
    await usage(f.attempt.id,"call_summary",100,10); // 600 micros
    await usage(second.id,"call_summary",200,20); // 1200 micros
    await usage(null,"brief_compilation",300,30); // 1800 shared micros
    await calls.updateStatus(f.brief.id,"failed");now=new Date(now.getTime()+6*60_000);await service.tick();
    expect(email.adminMessages).toHaveLength(2);
    const first=email.adminMessages.find(m=>m.content.text.includes(`Attempt ID: ${f.attempt.id}`))!.content.text;
    const last=email.adminMessages.find(m=>m.content.text.includes(`Attempt ID: ${second.id}`))!.content.text;
    expect(first).toContain("Attempt — Summary and assessment: US$0.0006");
    expect(first).not.toContain("US$0.0012");
    expect(last).toContain("Attempt — Summary and assessment: US$0.0012");
    expect(last).not.toContain("US$0.0006");
    for(const text of [first,last]) expect(text).toContain("Shared — Plan preparation: US$0.0018");
  });
});
