import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import postgres from "postgres";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresContentRepository } from "./postgres-content-repository";
import { seededContentPages, seededEditorialCollections } from "./seed-content";
import rules from "./transcript-copy-migration.json";
import optionalRules from "./optional-transcript-copy-migration.json";

const fixture = isolatedTestDatabase();
let sql: postgres.Sql;
let repository: PostgresContentRepository;
beforeAll(async () => {
  await fixture.setup(); sql = postgres(fixture.url, { max: 1 }); repository = new PostgresContentRepository(fixture.url);
});
afterAll(async () => { await repository?.close(); await sql?.end(); await fixture.teardown(); });
function oldCopy<T>(value: T): T {
  if (typeof value === "string") {
    const previous=optionalRules.find(rule=>rule.next===value)?.old[0]??value;
    return (rules.find(rule => rule.next === previous)?.old[0] ?? previous) as T;
  }
  if (Array.isArray(value)) return value.map(oldCopy) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, oldCopy(child)])) as T;
  return value;
}
it("upgrades current publications atomically, preserves editorial changes/drafts/history and refuses unknown target edits", async () => {
  const pages = oldCopy(seededContentPages);
  for (const page of pages.filter(page => page.key === "privacy")) {
    page.sections.push({ heading: "Editorial addition", paragraphs: ["Keep this authored text."], bullets: [] });
  }
  const collections = oldCopy(seededEditorialCollections);
  const landing = collections.find(collection => collection.revision.key === "landing")!;
  landing.revision.items.reverse();
  await repository.initializeSeedContent(pages);
  await repository.initializeSeedEditorialCollections(collections);
  await sql`INSERT INTO content_page_revisions(id,page_id,revision_number,status,requires_reacceptance,created_at,updated_at,required_locales)
    SELECT '90000000-0000-4000-8000-000000000001',page_id,2,'draft',false,now(),now(),required_locales FROM content_page_revisions
    WHERE page_id=(SELECT id FROM content_pages WHERE key='privacy')`;
  await sql`INSERT INTO content_page_revision_localizations(id,revision_id,locale,title,summary,sections,seo_title,seo_description,source_revision_number,created_at,updated_at)
    SELECT gen_random_uuid(),'90000000-0000-4000-8000-000000000001',locale,title,summary,sections,seo_title,seo_description,1,now(),now()
    FROM content_page_revision_localizations WHERE revision_id=${pages.find(page => page.key === "privacy")!.revision.id}`;
  const history = await sql`SELECT id,sections FROM content_page_revision_localizations ORDER BY id`;
  const migration = await readFile(new URL("../db/migrations/0088_conversation_transcript_copy.sql", import.meta.url), "utf8");
  await sql.begin(transaction => transaction.unsafe(migration));
  for (const locale of ["en", "de", "fr", "it", "rm", "ru", "uk"] as const) {
    const page = (await repository.getAdminRevision("privacy", locale, { status: "published" }))!;
    expect(page.revision.number).toBe(3);
    expect(page.revision.requiresReacceptance).toBe(false);
    expect(page.revision.createdByUserId).toBeNull();
    expect(page.sections[4]?.paragraphs[0]).toBe(rules.find(rule => rule.group === "page:privacy" && rule.locale === locale && rule.semantic === "transcript")!.next);
    expect(page.sections.at(-1)?.paragraphs).toEqual(["Keep this authored text."]);
    expect((await repository.getAdminRevision("privacy", locale, { status: "draft" }))?.revision.number).toBe(2);
  }
  const result = (await repository.getAdminEditorialCollection("landing")).published!;
  expect(result.items.map(item => item.id)).toEqual(landing.revision.items.map(item => item.id));
  const originalIds = history.slice(0).filter(row => !row.id.startsWith("9000")).map(row => row.id);
  const oldPublished = await sql`SELECT l.id,l.sections FROM content_page_revision_localizations l JOIN content_page_revisions r ON r.id=l.revision_id WHERE r.revision_number=1 ORDER BY l.id`;
  expect(oldPublished.every(row => JSON.stringify(row.sections) === JSON.stringify(history.find(old => old.id === row.id)?.sections))).toBe(true);
  expect(originalIds.length).toBeGreaterThan(0);
  const count = (await sql`SELECT count(*)::int AS n FROM content_page_revisions`)[0]!.n;
  await sql.begin(transaction => transaction.unsafe(migration));
  expect((await sql`SELECT count(*)::int AS n FROM content_page_revisions`)[0]!.n).toBe(count);
  // A later independently edited publication must be reviewed, never overwritten.
  await sql`INSERT INTO content_editorial_revisions(id,collection_id,revision_number,status,snapshot,created_at,updated_at,published_at,required_locales)
    SELECT gen_random_uuid(),collection_id,revision_number+1,'published',${sql.json(result.items.map(item => "blockType" in item && item.blockType === "how_it_works" ? { ...item, steps: [] } : item))},now(),now(),now(),required_locales
      FROM content_editorial_revisions WHERE id=${result.id}`;
  await expect(sql.begin(transaction => transaction.unsafe(migration))).rejects.toThrow("TRANSCRIPT_COPY_PREFLIGHT");
  expect((await sql`SELECT count(*)::int AS n FROM content_page_revisions`)[0]!.n).toBe(count);
});
it("publishes explicit-request and recording-availability copy without rewriting earlier legal evidence", async () => {
  const before=await sql`SELECT id,sections FROM content_page_revision_localizations ORDER BY id`;
  const migration=await readFile(new URL('../db/migrations/0094_optional_transcript_public_copy.sql',import.meta.url),'utf8');
  await sql.begin(tx=>tx.unsafe(migration));
  for(const locale of ['en','de','fr','it','rm','ru','uk'] as const) {
    const page=(await repository.getAdminRevision('privacy',locale,{status:'published'}))!;
    expect(page.sections[4]?.paragraphs[0]).toBe(optionalRules.find(rule=>rule.group==='page:privacy'&&rule.locale===locale&&rule.semantic==='transcript')!.next);
    expect(page.revision.requiresReacceptance).toBe(false);
  }
  const old=await sql`SELECT l.id,l.sections FROM content_page_revision_localizations l JOIN content_page_revisions r ON r.id=l.revision_id WHERE r.status='published' AND l.id IN ${sql(before.map(row=>row.id))}`;
  expect(old.every(row=>JSON.stringify(row.sections)===JSON.stringify(before.find(prior=>prior.id===row.id)?.sections))).toBe(true);
  const count=(await sql`SELECT count(*)::int AS n FROM content_page_revisions`)[0].n;
  await sql.begin(tx=>tx.unsafe(migration));
  expect((await sql`SELECT count(*)::int AS n FROM content_page_revisions`)[0].n).toBe(count);
});
