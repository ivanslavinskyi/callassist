import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { normalizeCreateCallBriefInput, type CreateCallBriefInput } from "@callassist/contracts";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "./postgres-call-repository";

describe("durable recipient opt-out",()=>{
  const database=isolatedTestDatabase(), key=Buffer.alloc(32,7);
  let sql:postgres.Sql, repository:PostgresCallRepository;
  beforeAll(async()=>{await database.setup();sql=postgres(database.url,{max:3,onnotice:()=>{}});repository=new PostgresCallRepository(database.url,key);});
  afterAll(async()=>{await repository?.close();await sql?.end();await database.teardown();});
  async function call(phoneNumber:string,provider:"twilio"|"mock"="twilio"){
    const input:CreateCallBriefInput={recipientName:"Contact test",phoneNumber,objective:"Ask when the office is open",assistantProfileId:"sebastian",representedPersonFirstName:"Nina",representedPersonLastName:"Keller",locale:"en-GB",allowLanguageSwitch:false,allowedFacts:[]};
    const brief=await repository.create(input,await new DeterministicBriefCompiler().compile(normalizeCreateCallBriefInput(input)));
    await repository.approveCompilation(brief.id,await originalPlanReview(repository,brief.id));
    const {attempt}=await repository.startAttempt(brief.id,{provider});
    await repository.attachProviderCall(attempt.id,`CA-${attempt.id}`,"queued");
    return {brief,attempt,sid:`CA-${attempt.id}`};
  }
  it("excludes queued and mock calls; preserves missed-call evidence and atomically blocks once",async()=>{
    const phone="+41791234567", c=await call(phone), input={phoneE164:phone,tokenHash:"a".repeat(64)};
    expect(await repository.recipientOptOut.reserve(input)).toBe(false);
    await repository.applyProviderStatus(c.sid,"no-answer","failed",c.brief.id);
    const reservations=await Promise.all([repository.recipientOptOut.reserve(input),repository.recipientOptOut.reserve({...input,tokenHash:"b".repeat(64)})]);
    expect(reservations.filter(Boolean)).toHaveLength(1);
    const active={...input,tokenHash:reservations[0]?input.tokenHash:"b".repeat(64)};
    await repository.recipientOptOut.activate(active);
    const claims=await Promise.all([repository.recipientOptOut.claim(active),repository.recipientOptOut.claim(active)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claim=claims.find(Boolean)!;
    expect(await repository.recipientOptOut.finish(active,claim,false)).toBe(false);
    const retry=await repository.recipientOptOut.claim(active);
    expect(retry).toBeTruthy();
    const finishes=await Promise.all([repository.recipientOptOut.finish(active,retry!,true),repository.recipientOptOut.finish(active,retry!,true)]);
    expect(finishes.filter(Boolean)).toHaveLength(1);
    expect((await sql`SELECT 1 FROM recipient_suppressions WHERE phone_e164=${phone} AND lifted_at IS NULL`).count).toBe(1);
    expect((await sql`SELECT 1 FROM safety_events WHERE phone_e164=${phone} AND event_type='recipient.suppressed'`).count).toBe(1);
    expect(await repository.recipientOptOut.reserve({...input,tokenHash:"c".repeat(64)})).toBe(false);
    const mock=await call("+41791234568","mock");
    await repository.applyProviderStatus(mock.sid,"completed","completed",mock.brief.id);
    expect(await repository.recipientOptOut.reserve({phoneE164:"+41791234568",tokenHash:"d".repeat(64)})).toBe(false);
  });
  it("backfills trusted earlier ringing even when the final status failed; survives source redaction and restarts",async()=>{
    const phone="+41791234569", c=await call(phone);
    await repository.applyProviderStatus(c.sid,"ringing","dialing",c.brief.id);
    await repository.applyProviderStatus(c.sid,"failed","failed",c.brief.id);
    const hash=repository.recipientOptOut.hash(phone);
    await sql`DELETE FROM recipient_contact_evidence WHERE recipient_hash=${hash}`;
    await sql`UPDATE call_attempts SET recipient_contact_hash=NULL WHERE id=${c.attempt.id}`;
    await sql`INSERT INTO recipient_contact_backfill (attempt_id) VALUES (${c.attempt.id})`;
    await repository.recipientOptOut.backfill();
    expect((await sql`SELECT 1 FROM recipient_contact_evidence WHERE recipient_hash=${hash}`).count).toBe(1);
    await sql`UPDATE call_briefs SET phone_number='',data_deleted_at=now() WHERE id=${c.brief.id}`;
    await sql`UPDATE call_attempts SET provider_call_id=NULL,execution_snapshot_ciphertext=NULL,compilation_id=NULL,compilation_revision=NULL,compilation_snapshot_hash=NULL WHERE id=${c.attempt.id}`;
    const reopened=new PostgresCallRepository(database.url,key);
    try{expect(await reopened.recipientOptOut.reserve({phoneE164:phone,tokenHash:"e".repeat(64)})).toBe(true);}finally{await reopened.close();}
  });
  it("rejects unsent, expired and mismatched challenges and exhausted guesses",async()=>{
    const phone="+41791234570",c=await call(phone),input={phoneE164:phone,tokenHash:"f".repeat(64)};
    await repository.applyProviderStatus(c.sid,"completed","completed",c.brief.id);
    expect(await repository.recipientOptOut.reserve(input)).toBe(true);
    expect(await repository.recipientOptOut.claim(input)).toBeNull();
    await repository.recipientOptOut.activate(input);
    expect(await repository.recipientOptOut.claim({...input,phoneE164:"+41791234571"})).toBeNull();
    for(let i=0;i<8;i++){const claim=await repository.recipientOptOut.claim(input);expect(claim).toBeTruthy();await repository.recipientOptOut.finish(input,claim!,false);}
    expect(await repository.recipientOptOut.claim(input)).toBeNull();
    await sql`UPDATE recipient_opt_out_challenges SET attempts=0,expires_at=now()-interval '1 second' WHERE token_hash=${input.tokenHash}`;
    expect(await repository.recipientOptOut.claim(input)).toBeNull();
  });
});
