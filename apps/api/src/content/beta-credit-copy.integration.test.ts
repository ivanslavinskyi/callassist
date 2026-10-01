import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import postgres from "postgres";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresContentRepository } from "./postgres-content-repository";
import { seededContentPages, seededEditorialCollections } from "./seed-content";
import rules from "./beta-credit-copy.json";

const fixture = isolatedTestDatabase();
let sql: postgres.Sql;
let repository: PostgresContentRepository;
beforeAll(async () => {
  await fixture.setup(); sql = postgres(fixture.url, { max: 1 }); repository = new PostgresContentRepository(fixture.url);
});
afterAll(async () => { await repository?.close(); await sql?.end(); await fixture.teardown(); });
function oldCopy<T>(value: T): T {
  if (typeof value === "string") return (rules.find(rule => rule.next === value)?.old[0] ?? value) as T;
  if (Array.isArray(value)) return value.map(oldCopy) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, oldCopy(child)])) as T;
  return value;
}

it("upgrades all seven current beta terms/landing locales, preserves history, and is idempotent", async () => {
  await repository.initializeSeedContent(oldCopy(seededContentPages));
  await repository.initializeSeedEditorialCollections(oldCopy(seededEditorialCollections));
  const history = await sql`SELECT id,sections FROM content_page_revision_localizations ORDER BY id`;
  const migration = await readFile(new URL("../db/migrations/0098_beta_credit_public_copy.sql", import.meta.url), "utf8");
  await sql.begin(tx => tx.unsafe(migration));
  const landing = (await repository.getAdminEditorialCollection("landing")).published!;
  for (const locale of ["en", "de", "fr", "it", "rm", "ru", "uk"] as const) {
    const page = (await repository.getAdminRevision("terms", locale, { status: "published" }))!;
    expect(page.revision.number).toBe(2);
    expect(page.revision.requiresReacceptance).toBe(false);
    const sections = JSON.stringify(page.sections);
    for (const rule of rules.filter(rule => rule.locale === locale)) {
      const contents = rule.group === "page:terms" ? sections : JSON.stringify(landing.items);
      expect(contents).toContain(rule.next);
      for (const old of rule.old) expect(contents).not.toContain(old);
    }
  }
  const original = await sql`SELECT id,sections FROM content_page_revision_localizations WHERE id IN ${sql(history.map(row => row.id))} ORDER BY id`;
  expect(original).toEqual(history);
  const count = (await sql`SELECT count(*)::int AS n FROM content_page_revisions`)[0].n;
  await sql.begin(tx => tx.unsafe(migration));
  expect((await sql`SELECT count(*)::int AS n FROM content_page_revisions`)[0].n).toBe(count);
  // An independently edited published target requires review and atomic rollback.
  await sql`INSERT INTO content_page_revisions(id,page_id,revision_number,status,requires_reacceptance,created_at,updated_at,published_at,required_locales)
    SELECT '90000000-0000-4000-8000-000000000098',page_id,3,'published',false,now(),now(),now(),required_locales FROM content_page_revisions r
      WHERE r.page_id=(SELECT id FROM content_pages WHERE key='terms') AND r.revision_number=2`;
  await sql`INSERT INTO content_page_revision_localizations(id,revision_id,locale,title,summary,sections,seo_title,seo_description,source_revision_number,created_at,updated_at)
    SELECT gen_random_uuid(),'90000000-0000-4000-8000-000000000098',l.locale,l.title,l.summary,
      CASE WHEN l.locale='en' THEN '[]'::jsonb ELSE l.sections END,l.seo_title,l.seo_description,3,now(),now()
    FROM content_page_revision_localizations l JOIN content_page_revisions r ON r.id=l.revision_id
    WHERE r.page_id=(SELECT id FROM content_pages WHERE key='terms') AND r.revision_number=2`;
  await expect(sql.begin(tx => tx.unsafe(migration))).rejects.toThrow("BETA_CREDIT_COPY_PREFLIGHT");
  expect((await sql`SELECT count(*)::int AS n FROM content_page_revisions`)[0].n).toBe(count + 1);
});
