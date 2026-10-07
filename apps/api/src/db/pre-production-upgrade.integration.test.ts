import "../config/load-env";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApprovedExecutionSnapshot, normalizeCreateCallBriefInput } from "@callassist/contracts";
import { readMigrationCatalog, runMigrations } from "./migrate";
import { requireTestDatabaseUrl } from "./require-test-database";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { createCompilationSnapshotHash } from "../brief-compiler/compilation-integrity";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { encryptJson } from "../security/encryption";
import { backfillPlanReviewCases } from "./backfill-plan-reviews";

// This fixture starts at the real pre-release catalog, then exercises the normal
// migration runner over populated tables. Never downgrades or uses the app DB.
const base = new URL(requireTestDatabaseUrl());
const databaseName = `callassist_upgrade_${randomUUID().replaceAll("-", "")}_test`;
const target = new URL(base); target.pathname = `/${databaseName}`; base.pathname = "/postgres";
const admin = postgres(base.toString(), { max: 1, onnotice: () => undefined });
const key = Buffer.alloc(32, 93);
let created = false, sql: postgres.Sql, calls: PostgresCallRepository;
let owner: string, unverified: string, attemptId: string, historicalAttemptId: string, briefId: string, rejectedId: string;
let beforeLedger: readonly unknown[], beforeApprovals: readonly unknown[], beforeCompilations: readonly unknown[], beforeReceipts: readonly unknown[];

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE "${databaseName}" TEMPLATE template0`); created = true;
  sql = postgres(target.toString(), { max: 3, onnotice: () => undefined });
  await sql`CREATE TABLE schema_migrations(name text PRIMARY KEY, checksum_sha256 varchar(64), applied_at timestamptz NOT NULL DEFAULT now())`;
  for (const migration of (await readMigrationCatalog()).filter(m => m.sequence <= 94)) {
    await sql.begin(async tx => {
      await tx.unsafe(migration.sql);
      await tx`INSERT INTO schema_migrations(name,checksum_sha256) VALUES(${migration.name},${migration.checksumSha256})`;
    });
  }
  owner = randomUUID(); unverified = randomUUID(); attemptId = randomUUID();
  for (const [id, phone, verified] of [[owner, "+41755550001", true], [unverified, "+41755550002", false]] as const) {
    await sql`INSERT INTO users(id,email,password_hash,phone_e164,phone_verified_at,first_name,last_name,created_at)
      VALUES(${id},${`${id}@example.test`},'synthetic-only',${phone},${verified ? new Date() : null},'Upgrade','Fixture',now())`;
  }
  await sql`UPDATE users SET ui_locale='ru',email_verified_at=now() WHERE id=${owner}`;
  const input = normalizeCreateCallBriefInput({ recipientName: "Office", phoneNumber: "+41755550100", objective: "Ask when the office opens",
    assistantProfileId: "sebastian", representedPersonFirstName: "Upgrade", representedPersonLastName: "Fixture", locale: "en-GB", allowedFacts: [] });
  const compiler = new DeterministicBriefCompiler();
  const legacyCalls = new InMemoryCallRepository();
  // Persist only columns present at 0094. Current SQL repositories require the
  // current catalog and must not be used to manufacture a pre-migration fixture.
  const seedLegacyCall = async (approve = false) => {
    const compilation = await compiler.compile(input);
    const brief = await legacyCalls.create(input, compilation, owner);
    const source = await legacyCalls.getPlanSource(brief.id);
    await sql`INSERT INTO call_briefs(id,user_id,recipient_name,phone_number,objective,locale,
        assistant_profile_id,agent_name,represented_person,represented_person_first_name,represented_person_last_name,
        voice_gender,audio_retention_days,allowed_facts_ciphertext,status,created_at,updated_at)
      VALUES(${brief.id},${owner},${brief.recipientName},${brief.phoneNumber},${brief.objective},${brief.locale},
        ${brief.assistantProfileId},${brief.agentName},${brief.representedPerson},${brief.representedPersonFirstName},${brief.representedPersonLastName},
        ${brief.voiceGender},${brief.audioRetentionDays},${encryptJson(brief.allowedFacts,key)},'review_required',${brief.createdAt},${brief.updatedAt})`;
    await sql`INSERT INTO call_compilations(id,call_brief_id,revision,snapshot_hash,compilation_ciphertext,origin,created_at)
      VALUES(${source.compilationId},${brief.id},${compilation.revision},${compilation.snapshotHash},${encryptJson(compilation,key)},'native',${compilation.compiledAt})`;
    await sql`UPDATE call_briefs SET current_compilation_id=${source.compilationId} WHERE id=${brief.id}`;
    if (approve) {
      const approved = await legacyCalls.approveCompilation(brief.id, await originalPlanReview(legacyCalls,brief.id));
      const receipt = (await legacyCalls.getCurrentReviewReceipt(brief.id))!;
      await sql`INSERT INTO call_plan_review_receipts(id,call_brief_id,compilation_id,revision,snapshot_hash,mode,language,selection_revision,payload_ciphertext,created_at)
        VALUES(${receipt.id},${brief.id},${source.compilationId},${receipt.revision},${receipt.snapshotHash},'original',
          ${receipt.evidence.language},${receipt.evidence.selectionRevision},${encryptJson(receipt,key)},${receipt.createdAt})`;
      await sql`INSERT INTO call_compilation_approvals(id,call_brief_id,compilation_id,revision,snapshot_hash,approved_at,execution_snapshot_ciphertext)
        VALUES(${randomUUID()},${brief.id},${source.compilationId},${compilation.revision},${compilation.snapshotHash},
          ${approved.compilation!.approvedAt},${encryptJson(createApprovedExecutionSnapshot(approved),key)})`;
      await sql`UPDATE call_briefs SET status='ready' WHERE id=${brief.id}`;
    }
    return brief;
  };
  const brief = await seedLegacyCall(true); briefId = brief.id;
  await sql`INSERT INTO call_attempts(id,call_brief_id,user_id,provider,provider_call_id,status,provider_status,started_at,created_at,
      compilation_id,compilation_revision,compilation_snapshot_hash,execution_snapshot_ciphertext,review_receipt_id,content_language)
    SELECT ${attemptId},a.call_brief_id,${owner},'twilio',${`CA-${attemptId}`},'dialing','initiated',now(),now(),
      a.compilation_id,a.revision,a.snapshot_hash,a.execution_snapshot_ciphertext,r.id,r.language
    FROM call_compilation_approvals a JOIN call_plan_review_receipts r USING(compilation_id) WHERE a.call_brief_id=${brief.id}`;
  historicalAttemptId = randomUUID();
  await sql`INSERT INTO call_attempts(id,call_brief_id,user_id,provider,provider_call_id,status,provider_status,started_at,ended_at,created_at,
      compilation_id,compilation_revision,compilation_snapshot_hash,execution_snapshot_ciphertext,review_receipt_id,content_language)
    SELECT ${historicalAttemptId},call_brief_id,user_id,provider,${`CA-${historicalAttemptId}`},'completed','completed',
      now()-interval '1 day',now()-interval '1 day'+interval '1 minute',now()-interval '1 day',
      compilation_id,compilation_revision,compilation_snapshot_hash,execution_snapshot_ciphertext,review_receipt_id,content_language
    FROM call_attempts WHERE id=${attemptId}`;
  await sql`UPDATE call_briefs SET status='dialing' WHERE id=${brief.id}`;
  for (const [amount, type, idempotency, attempt] of [
    [3, "signup_grant", `signup:${owner}`, null], [4, "admin_grant", "upgrade:manual", null],
    [-1, "call_reservation", `call:${attemptId}:reservation`, attemptId]
  ] as const) {
    await sql`INSERT INTO credit_transactions(id,user_id,amount,type,idempotency_key,call_attempt_id,admin_id,reason,created_at)
      VALUES(${randomUUID()},${owner},${amount},${type},${idempotency},${attempt},${type === "admin_grant" ? owner : null},'Synthetic upgrade fixture',now())`;
  }
  // Seed an immutable returned revision as it existed before the new review index.
  const rejected = await seedLegacyCall(); rejectedId = rejected.id;
  const compilation = await compiler.compile(input, 2);
  compilation.policyDecision = { ...compilation.policyDecision, status: "blocked", reasonCodes: ["prohibited_content"], riskLevel: "high" };
  compilation.snapshotHash = createCompilationSnapshotHash(compilation);
  const compilationId = randomUUID();
  await sql`INSERT INTO call_compilations(id,call_brief_id,revision,snapshot_hash,compilation_ciphertext,origin,created_at)
    VALUES(${compilationId},${rejected.id},2,${compilation.snapshotHash},${encryptJson(compilation, key)},'native',${compilation.compiledAt})`;
  await sql`UPDATE call_briefs SET current_compilation_id=${compilationId},status='blocked' WHERE id=${rejected.id}`;
  await sql`INSERT INTO transcript_segments(id,call_brief_id,call_attempt_id,role,text,locale,final,created_at)
    VALUES(${randomUUID()},${brief.id},${attemptId},'system','Synthetic legacy linked segment','en-GB',true,now()),
      (${randomUUID()},${rejected.id},NULL,'system','Synthetic unattributed segment','en-GB',true,now())`;
  await sql`INSERT INTO provider_operations(id,provider,operation_type,stage,requested_model,client_request_id,call_brief_id,started_at)
    VALUES(${randomUUID()},'openai','brief_compilation','compiler','synthetic','upgrade:operation',${brief.id},now())`;
  await sql`INSERT INTO admin_telemetry_exports(id,actor_user_id,request_id,input_hash,reason,from_at,to_at,status)
    VALUES(${randomUUID()},${owner},${randomUUID()},'synthetic','Synthetic upgrade fixture',now()-interval '1 day',now(),'queued')`;
  beforeLedger = (await sql`SELECT to_jsonb(t) AS original FROM credit_transactions t ORDER BY id`).map(r => r.original);
  beforeApprovals = await sql`SELECT * FROM call_compilation_approvals ORDER BY id`;
  beforeCompilations = await sql`SELECT * FROM call_compilations ORDER BY id`;
  beforeReceipts = await sql`SELECT * FROM call_plan_review_receipts ORDER BY id`;
  await runMigrations(target.toString());
  calls = new PostgresCallRepository(target.toString(), key);
}, 60000);

afterAll(async () => {
  await calls?.close(); await sql?.end();
  try { if (created && /^callassist_upgrade_[a-f0-9]{32}_test$/.test(databaseName)) await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`); }
  finally { await admin.end(); }
});

describe("populated 0094 to current pre-production upgrade", () => {
  it("freezes legacy UI language and never enqueues historical completed attempts", async () => {
    expect(await sql`SELECT creation_ui_locale FROM call_briefs ORDER BY id`)
      .toEqual([{ creation_ui_locale: "ru" }, { creation_ui_locale: "ru" }]);
    expect(await sql`SELECT id FROM user_call_notifications WHERE call_attempt_id=${historicalAttemptId}`).toHaveLength(0);
    await sql`UPDATE users SET ui_locale='fr' WHERE id=${owner}`;
    await runMigrations(target.toString());
    expect((await calls.get(briefId))?.brief.creationUiLocale).toBe("ru");
    expect(await sql`SELECT id FROM user_call_notifications WHERE call_attempt_id=${historicalAttemptId}`).toHaveLength(0);
  });
  it("preserves immutable ledger, approvals and execution plans, with nullable additive provenance", async () => {
    expect((await sql`SELECT to_jsonb(t)-'beta_period_id' AS original FROM credit_transactions t ORDER BY id`).map(r => r.original))
      .toEqual(beforeLedger);
    expect(await sql`SELECT * FROM call_compilation_approvals ORDER BY id`).toEqual(beforeApprovals);
    expect(await sql`SELECT * FROM call_compilations ORDER BY id`).toEqual(beforeCompilations);
    expect(await sql`SELECT * FROM call_plan_review_receipts ORDER BY id`).toEqual(beforeReceipts);
    expect(await sql`SELECT beta_period_id FROM credit_transactions WHERE beta_period_id IS NOT NULL`).toHaveLength(0);
    expect((await sql`SELECT count(*)::int AS count FROM beta_credit_enrollments`)[0]!.count).toBe(2);
    expect((await calls.getCreditUsage(owner)).balance).toBe(6);
    await Promise.all(Array.from({ length: 4 }, () => calls.grantSignupCredits(owner)));
    expect((await calls.getCreditUsage(owner)).transactions).toHaveLength(3);
    expect(await calls.getAttempt(briefId, attemptId)).toMatchObject({ id: attemptId });
  });

  it("settles a pre-upgrade reservation once into the persistent source and recovers delayed verification once", async () => {
    await calls.applyProviderStatus(`CA-${attemptId}`, "busy", "failed", briefId);
    await calls.applyProviderStatus(`CA-${attemptId}`, "busy", "failed", briefId);
    const usage = await calls.getCreditUsage(owner);
    expect(usage).toMatchObject({ balance: 7, funding: { persistent: 7 } });
    expect(usage.transactions.filter(t => t.type === "call_refund")).toMatchObject([{ betaPeriodId: null, amount: 1 }]);
    expect((await calls.getCreditUsage(unverified)).balance).toBe(0);
    await sql`UPDATE users SET phone_verified_at=now() WHERE id=${unverified}`;
    await Promise.all([calls.grantSignupCredits(unverified), calls.grantSignupCredits(unverified)]);
    expect((await calls.getCreditUsage(unverified)).balance).toBe(3);
    expect((await calls.getCreditUsage(unverified)).transactions).toHaveLength(1);
  });

  it("labels historical attribution conservatively, keeps old exports metadata-only and supports idempotent review backfill", async () => {
    const segments = await sql`SELECT call_brief_id,attempt_attribution FROM transcript_segments ORDER BY attempt_attribution`;
    expect(segments).toMatchObject([{ call_brief_id: briefId, attempt_attribution: "legacy_inferred" }, { call_brief_id: rejectedId, attempt_attribution: "unknown" }]);
    expect(await sql`SELECT include_audio FROM admin_telemetry_exports`).toMatchObject([{ include_audio: false }]);
    expect(await sql`SELECT runtime_descriptor FROM call_attempts`).toMatchObject([{ runtime_descriptor: null }, { runtime_descriptor: null }]);
    expect(await sql`SELECT request_metadata FROM provider_operations`).toMatchObject([{ request_metadata: null }]);
    expect(await backfillPlanReviewCases(sql, key)).toMatchObject({ mode: "dry_run", eligible: 1, inserted: 0, unavailable: 0 });
    expect(await backfillPlanReviewCases(sql, key, true)).toMatchObject({ eligible: 1, inserted: 1, unavailable: 0 });
    expect(await backfillPlanReviewCases(sql, key, true)).toMatchObject({ eligible: 0, inserted: 0, unavailable: 0 });
    expect(await sql`SELECT historical,call_brief_id FROM plan_review_cases`).toMatchObject([{ historical: true, call_brief_id: rejectedId }]);
    expect(await sql`SELECT id FROM superadmin_notifications`).toHaveLength(0);
    await runMigrations(target.toString());
    expect(await sql`SELECT * FROM call_compilation_approvals ORDER BY id`).toEqual(beforeApprovals);
  });
});
