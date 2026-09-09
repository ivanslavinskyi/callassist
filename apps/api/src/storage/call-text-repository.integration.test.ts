import "../config/load-env";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { normalizeCreateCallBriefInput } from "@callassist/contracts";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "./postgres-call-repository";
import { callTextRepositorySuite } from "./call-text-repository.test-suite";

describe("Postgres text artifact storage",()=>{
  const database=isolatedTestDatabase(),owner=randomUUID();
  let sql:postgres.Sql,repository:PostgresCallRepository;
  beforeAll(async()=>{
    await database.setup();
    sql=postgres(database.url,{max:1});
    await sql`INSERT INTO users(id,email,password_hash,phone_e164,phone_verified_at,first_name,last_name,role,status,ui_locale,created_at)
      VALUES(${owner},${`${owner}@example.com`},'test-only','+41710000309',now(),'Nina','Keller','user','active','en',now())`;
    repository=new PostgresCallRepository(database.url,Buffer.alloc(32,9));
  },30000);
  afterAll(async()=>{await repository?.close();await sql?.end();await database.teardown();});
  callTextRepositorySuite(()=>repository,()=>owner);

  it("grandfathers only exact pre-cutover approvals and requires v2 for a new revision",async()=>{
    const input=normalizeCreateCallBriefInput({recipientName:"Gemeinde",phoneNumber:"+41523686688",objective:"Ask whether my residence form arrived",
      assistantProfileId:"sebastian",representedPersonFirstName:"Nina",representedPersonLastName:"Keller",locale:"de-CH",
      audioRetentionDays:0,allowLanguageSwitch:false,allowedFacts:[]});
    const compiler=new DeterministicBriefCompiler(),compilation=await compiler.compile(input);
    const approved=await repository.create(input,compilation,owner),unapproved=await repository.create(input,compilation,owner),edited=await repository.create(input,compilation,owner);
    for(const brief of [approved,edited]) await repository.approveCompilation(brief.id,{revision:compilation.revision,snapshotHash:compilation.snapshotHash,
      review:{mode:"original",language:"de-CH",selectionRevision:1}});
    await expect(sql`INSERT INTO call_attempts(id,call_brief_id,user_id,provider,status,compilation_id,compilation_revision,compilation_snapshot_hash,execution_snapshot_ciphertext,created_at)
      SELECT ${randomUUID()},c.call_brief_id,${owner},'mock','dialing',c.id,c.revision,c.snapshot_hash,a.execution_snapshot_ciphertext,now()
      FROM call_compilations c JOIN call_compilation_approvals a ON a.compilation_id=c.id
      JOIN call_briefs b ON b.current_compilation_id=c.id WHERE b.id=${approved.id}`)
      .rejects.toMatchObject({code:"23514",message:"current plan review receipt required"});
    // Recreate the real pre-0066 boundary only inside this disposable fixture database.
    await sql.begin(async tx=>{
      await tx.unsafe(`DROP TRIGGER call_attempts_require_review_receipt ON call_attempts;
        ALTER TABLE call_attempts DROP CONSTRAINT call_attempts_review_receipt_fk, DROP COLUMN review_receipt_id, DROP COLUMN content_language;
        DROP TABLE call_plan_review_receipts;
        DROP TRIGGER call_compilation_review_policy_created ON call_compilations;
        DROP TABLE call_compilation_review_policies;
        DROP FUNCTION enforce_attempt_review_receipt(), create_compilation_review_policy(), prevent_review_policy_mutation();`);
      await tx.unsafe(await readFile(new URL("../db/migrations/0066_call_plan_review_receipts.sql",import.meta.url),"utf8"));
    });
    expect((await repository.getPlanSource(approved.id)).reviewPolicyVersion).toBe(1);
    expect((await repository.getPlanSource(unapproved.id)).reviewPolicyVersion).toBe(2);
    await expect(repository.approveCompilation(unapproved.id)).rejects.toMatchObject({code:"CALL_REVIEW_REQUIRED"});
    const attempt=await repository.startAttempt(approved.id,{provider:"mock"});
    expect(attempt.attempt.reviewReceiptId).toBeNull();
    await repository.stop(approved.id);
    const next=await compiler.compile({...input,objective:"Ask whether my form arrived and when it will be processed"},2);
    expect((await repository.getPlanSource(edited.id)).reviewPolicyVersion).toBe(1);
    await repository.recompile(edited.id,{...input,objective:"Ask whether my form arrived and when it will be processed"},next);
    expect((await repository.getPlanSource(edited.id)).reviewPolicyVersion).toBe(2);
    await expect(repository.approveCompilation(edited.id)).rejects.toMatchObject({code:"CALL_REVIEW_REQUIRED"});
  });
});
