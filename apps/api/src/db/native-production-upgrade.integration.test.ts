import "../config/load-env";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApprovedExecutionSnapshot, normalizeCreateCallBriefInput } from "@callassist/contracts";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { PostgresContentRepository } from "../content/postgres-content-repository";
import { seededContentPages, seededEditorialCollections } from "../content/seed-content";
import retentionRules from "../content/retention-copy-migration.json";
import { decryptJson, encryptJson, parseDataEncryptionKeyring } from "../security/encryption";
import { backfillObjectives } from "./backfill-objectives";
import { readMigrationCatalog, runMigrations } from "./migrate";
import { requireTestDatabaseUrl } from "./require-test-database";

// Rehearse the Native v2 release over populated 0109 tables, never a working DB.
const base = new URL(requireTestDatabaseUrl());
const name = `callassist_native_upgrade_${randomUUID().replaceAll("-", "")}_test`;
const target = new URL(base); target.pathname = `/${name}`; base.pathname = "/postgres";
const admin = postgres(base.toString(), { max: 1, onnotice: () => undefined });
const key = Buffer.alloc(32, 91);
const callIds: string[] = [];
const objective = "Ask office hours for synthetic member 001234567.";
let created = false, sql: postgres.Sql, content: PostgresContentRepository;
let beforeRecordings: readonly unknown[], beforePublications: readonly unknown[], beforeLocales: readonly unknown[];
let beforeEditorial: readonly unknown[];
let beforeApprovals: readonly unknown[], beforeCompilations: readonly unknown[], beforeReceipts: readonly unknown[];

function previousRetention<T>(value: T): T {
  if (typeof value === "string") return (retentionRules.find(rule => rule.next === value)?.old[0] ?? value) as T;
  if (Array.isArray(value)) return value.map(previousRetention) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, previousRetention(child)])) as T;
  }
  return value;
}

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
  sql = postgres(target.toString(), { max: 1, onnotice: () => undefined });
  await sql`CREATE TABLE schema_migrations(name text PRIMARY KEY, checksum_sha256 varchar(64), applied_at timestamptz NOT NULL DEFAULT now())`;
  for (const migration of (await readMigrationCatalog()).filter(m => m.sequence <= 109)) {
    await sql.begin(async tx => {
      await tx.unsafe(migration.sql);
      await tx`INSERT INTO schema_migrations(name,checksum_sha256) VALUES(${migration.name},${migration.checksumSha256})`;
    });
  }
  const compiler = new DeterministicBriefCompiler(), memory = new InMemoryCallRepository();
  for (const [index, days] of ([0, 7, 30] as const).entries()) {
    const input = normalizeCreateCallBriefInput({ recipientName: "Synthetic Office", phoneNumber: "+41755550100",
      objective, locale: "en-GB", representedPersonFirstName: "Synthetic", representedPersonLastName: "Owner",
      assistantProfileId: "sebastian", audioRetentionDays: days, allowedFacts: [] });
    const compilation = await compiler.compile(input);
    const brief = await memory.create(input, compilation);
    const id = brief.id, attempt = randomUUID(); callIds[index] = id;
    const source = await memory.getPlanSource(id);
    const approved = await memory.approveCompilation(id, await originalPlanReview(memory, id));
    const receipt = (await memory.getCurrentReviewReceipt(id))!;
    await sql`INSERT INTO call_briefs(id,recipient_name,phone_number,objective,locale,represented_person,represented_person_first_name,
      represented_person_last_name,allowed_facts_ciphertext,audio_retention_days,status,created_at,updated_at)
      VALUES(${id},'Synthetic Office','+41755550100',${objective},'en-GB','Synthetic Owner','Synthetic','Owner',${encryptJson([], key)},${days},'completed',now(),now())`;
    await sql`INSERT INTO call_compilations(id,call_brief_id,revision,snapshot_hash,compilation_ciphertext,origin,created_at)
      VALUES(${source.compilationId},${id},${compilation.revision},${compilation.snapshotHash},${encryptJson(compilation,key)},'native',${compilation.compiledAt})`;
    await sql`UPDATE call_briefs SET current_compilation_id=${source.compilationId} WHERE id=${id}`;
    await sql`INSERT INTO call_plan_review_receipts(id,call_brief_id,compilation_id,revision,snapshot_hash,mode,language,selection_revision,payload_ciphertext,created_at)
      VALUES(${receipt.id},${id},${source.compilationId},${receipt.revision},${receipt.snapshotHash},'original',
        ${receipt.evidence.language},${receipt.evidence.selectionRevision},${encryptJson(receipt,key)},${receipt.createdAt})`;
    await sql`INSERT INTO call_compilation_approvals(id,call_brief_id,compilation_id,revision,snapshot_hash,approved_at,execution_snapshot_ciphertext)
      VALUES(${randomUUID()},${id},${source.compilationId},${compilation.revision},${compilation.snapshotHash},
        ${approved.compilation!.approvedAt},${encryptJson(createApprovedExecutionSnapshot(approved),key)})`;
    await sql`INSERT INTO call_attempts(id,call_brief_id,provider,provider_call_id,status,started_at,ended_at,created_at,
      compilation_id,compilation_revision,compilation_snapshot_hash,execution_snapshot_ciphertext,review_receipt_id,content_language)
      SELECT ${attempt},${id},'twilio',${`CA-${attempt}`},'completed',now()-interval '1 minute',now(),now(),
        a.compilation_id,a.revision,a.snapshot_hash,a.execution_snapshot_ciphertext,${receipt.id},${receipt.evidence.language}
        FROM call_compilation_approvals a WHERE a.call_brief_id=${id}`;
    await sql`INSERT INTO call_recordings(id,call_brief_id,call_attempt_id,provider,provider_call_id,status,
      consent_granted_at,completed_at,delete_after,created_at,updated_at)
      VALUES(${randomUUID()},${id},${attempt},'twilio',${`CA-${attempt}`},'available',now()-interval '1 minute',
        now(),now()+${days}*interval '1 day',now(),now())`;
  }
  // Existing soft-deleted tasks must not be re-encrypted or resurrected.
  await sql`UPDATE call_briefs SET data_deleted_at=now(),objective='Deleted task' WHERE id=${callIds[0]!}`;
  content = new PostgresContentRepository(target.toString());
  await content.initializeSeedContent(previousRetention(seededContentPages));
  await content.initializeSeedEditorialCollections(previousRetention(seededEditorialCollections));
  beforeRecordings = await sql`SELECT to_jsonb(r) AS original FROM call_recordings r ORDER BY id`;
  beforePublications = await sql`SELECT * FROM content_page_revisions ORDER BY id`;
  beforeLocales = await sql`SELECT * FROM content_page_revision_localizations ORDER BY id`;
  beforeEditorial = await sql`SELECT * FROM content_editorial_revisions ORDER BY id`;
  beforeApprovals = await sql`SELECT * FROM call_compilation_approvals ORDER BY id`;
  beforeCompilations = await sql`SELECT * FROM call_compilations ORDER BY id`;
  beforeReceipts = await sql`SELECT * FROM call_plan_review_receipts ORDER BY id`;
  await runMigrations(target.toString());
}, 60000);

afterAll(async () => {
  await content?.close(); await sql?.end();
  try {
    if (created && /^callassist_native_upgrade_[a-f0-9]{32}_test$/.test(name)) {
      await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
  } finally { await admin.end(); }
});

it("upgrades 0109 without changing existing recording retention or consent, and replays safely", async () => {
  expect(await sql`SELECT to_jsonb(r)-'recording_basis' AS original FROM call_recordings r ORDER BY id`)
    .toEqual(beforeRecordings);
  expect(await sql`SELECT DISTINCT recording_basis FROM call_recordings`).toEqual([{ recording_basis: "affirmative_consent" }]);
  expect(await sql`SELECT audio_retention_days FROM call_briefs ORDER BY audio_retention_days`)
    .toEqual([0, 7, 30].map(audio_retention_days => ({ audio_retention_days })));
  expect((await sql`SELECT column_default FROM information_schema.columns
    WHERE table_name='call_briefs' AND column_name='audio_retention_days'`)[0]!.column_default).toBe("30");
  const before = await sql`SELECT * FROM schema_migrations ORDER BY name`;
  expect(before.at(-1)!.name).toBe("0116_preparation_validation_events.sql");
  await runMigrations(target.toString());
  expect(await sql`SELECT * FROM schema_migrations ORDER BY name`).toEqual(before);
  expect(await sql`SELECT * FROM call_compilation_approvals ORDER BY id`).toEqual(beforeApprovals);
  expect(await sql`SELECT * FROM call_compilations ORDER BY id`).toEqual(beforeCompilations);
  expect(await sql`SELECT * FROM call_plan_review_receipts ORDER BY id`).toEqual(beforeReceipts);
});

it("encrypts only live legacy objectives, verifies the key, and keeps deletion fenced", async () => {
  const env = { DATABASE_URL: target.toString(), DATA_ENCRYPTION_KEY: key.toString("base64") };
  expect(await backfillObjectives([], env)).toEqual({ mode: "dry_run", candidates: 2, updated: 0 });
  expect(await backfillObjectives(["--execute"], env)).toEqual({ mode: "execute", candidates: 2, updated: 2 });
  expect(await backfillObjectives(["--execute"], env)).toEqual({ mode: "execute", candidates: 0, updated: 0 });
  for (const id of callIds.slice(1)) {
    const [row] = await sql`SELECT objective,objective_ciphertext FROM call_briefs WHERE id=${id}`;
    expect(row!.objective).toBe("Encrypted task");
    expect(decryptJson(row!.objective_ciphertext, parseDataEncryptionKeyring(env))).toBe(objective);
  }
  await sql`UPDATE call_briefs SET objective_ciphertext=${encryptJson("late data", key)} WHERE id=${callIds[0]!}`;
  expect((await sql`SELECT objective_ciphertext FROM call_briefs WHERE id=${callIds[0]!}`)[0]!.objective_ciphertext).toBeNull();
  expect(await sql`SELECT * FROM call_compilation_approvals ORDER BY id`).toEqual(beforeApprovals);
});

it("publishes 30-day copy in all locales while preserving earlier publications", async () => {
  for (const locale of ["en", "de", "fr", "it", "rm", "ru", "uk"] as const) {
    const page = (await content.getAdminRevision("privacy", locale, { status: "published" }))!;
    expect(page.revision.number).toBe(2);
    expect(page.revision.requiresReacceptance).toBe(false);
    for (const rule of retentionRules.filter(rule => rule.group === "page:privacy" && rule.locale === locale)) {
      expect(JSON.stringify(page.sections)).toContain(rule.next);
    }
  }
  const landing = (await content.getAdminEditorialCollection("landing")).published!;
  for (const rule of retentionRules.filter(rule => rule.group === "collection:landing")) {
    expect(JSON.stringify(landing.items)).toContain(rule.next);
  }
  const publications = await sql`SELECT * FROM content_page_revisions ORDER BY id`;
  const locales = await sql`SELECT * FROM content_page_revision_localizations ORDER BY id`;
  const editorial = await sql`SELECT * FROM content_editorial_revisions ORDER BY id`;
  expect(publications).toEqual(expect.arrayContaining([...beforePublications]));
  expect(locales).toEqual(expect.arrayContaining([...beforeLocales]));
  expect(editorial).toEqual(expect.arrayContaining([...beforeEditorial]));
  const migration = (await readMigrationCatalog()).find(m => m.sequence === 115)!;
  await sql.begin(tx => tx.unsafe(migration.sql));
  expect(await sql`SELECT * FROM content_page_revisions ORDER BY id`).toEqual(publications);
  expect(await sql`SELECT * FROM content_editorial_revisions ORDER BY id`).toEqual(editorial);
});

it("aborts an unrecognized retention edit atomically instead of overwriting authored content", async () => {
  const landing = (await content.getAdminEditorialCollection("landing")).published!;
  await sql`INSERT INTO content_editorial_revisions(id,collection_id,revision_number,status,snapshot,
    created_at,updated_at,published_at,required_locales)
    SELECT gen_random_uuid(),collection_id,revision_number+1,'published','[]'::jsonb,
      now(),now(),now(),required_locales FROM content_editorial_revisions WHERE id=${landing.id}`;
  const before = await sql`SELECT * FROM content_editorial_revisions ORDER BY id`;
  const pages = await sql`SELECT * FROM content_page_revisions ORDER BY id`;
  const migration = (await readMigrationCatalog()).find(m => m.sequence === 115)!;
  await expect(sql.begin(tx => tx.unsafe(migration.sql))).rejects.toThrow("RETENTION_COPY_PREFLIGHT");
  expect(await sql`SELECT * FROM content_editorial_revisions ORDER BY id`).toEqual(before);
  expect(await sql`SELECT * FROM content_page_revisions ORDER BY id`).toEqual(pages);
});
