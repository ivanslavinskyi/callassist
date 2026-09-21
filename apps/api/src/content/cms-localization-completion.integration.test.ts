import "../config/load-env";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import postgres from "postgres";
import { contentUiLocales, type AdminEditorialRevision } from "@callassist/contracts";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { ContentService } from "./content-service";
import { PostgresContentRepository } from "./postgres-content-repository";
import { completeCmsLocales, fillEditorialLocaleGaps } from "./cms-localization-completion";
import { seededContentPages, seededEditorialCollections } from "./seed-content";

const database = isolatedTestDatabase();
const actorId = randomUUID(), actorEmail = `${actorId}@example.test`;
let sql: postgres.Sql, repo: PostgresContentRepository;
function englishGerman(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(englishGerman);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if ("en" in record) return { en: record.en, de: record.de };
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, englishGerman(item)]));
}
beforeAll(async () => {
  await database.setup(); sql = postgres(database.url, { max: 1 });
  await sql`INSERT INTO users(id,email,password_hash,phone_e164,phone_verified_at,first_name,last_name,role,status,ui_locale,created_at)
    VALUES(${actorId},${actorEmail},'fixture-only','+41710000319',now(),'CMS','Editor','content_editor','active','en',now())`;
  repo = new PostgresContentRepository(database.url);
  const service = new ContentService(repo);
  await repo.initializeSeedContent(seededContentPages.filter(p => ["en", "de"].includes(p.locale) || p.key === "support" && p.locale === "fr"));
  const collections = structuredClone(seededEditorialCollections);
  const landing = collections.find(c => c.revision.key === "landing")!.revision;
  landing.items = englishGerman(landing.items) as typeof landing.items;
  landing.items.reverse(); landing.requiredLocales = ["en", "de"];
  const hero = landing.items.find(item => "blockType" in item && item.blockType === "hero");
  if (hero && "title" in hero) hero.title.fr = "Une rédaction existante";
  await repo.initializeSeedEditorialCollections(collections);
  await service.createDraft(actorId, "imprint");
  await service.createEditorialDraft(actorId, "landing");
}, 60000);
afterAll(async () => { await repo?.close(); await sql?.end(); await database.teardown(); });

it("fills exact published/draft revisions atomically, keeps source layout, author copy and legal acceptance, and is replay-safe", async () => {
  const beforeRows = await sql`SELECT * FROM content_page_revision_localizations ORDER BY id`;
  const beforeLanding = await repo.getAdminEditorialCollection("landing");
  const beforeImprint = await repo.getAdminRevision("imprint", "en", { status: "draft" });
  const legal = (await repo.getOnboardingStatus(actorId, "en")).current;
  await repo.acceptOnboarding(actorId, { locale: "en", termsRevisionId: legal.terms.id, acceptableUseRevisionId: legal.acceptableUse.id,
    acceptTerms: true, acceptAcceptableUse: true, acknowledgeConsent: true, acknowledgeRetention: true,
    acknowledgeUseLimits: true, acknowledgeCredits: true }, new Date().toISOString());
  const acceptances = await repo.listOnboardingAcceptances(actorId);
  const dry = await completeCmsLocales(database.url);
  expect(dry.summary.pageTranslations).toBeGreaterThan(25);
  expect(dry.summary.collections.map(c => c.status)).toEqual(["published"]);
  expect(await sql`SELECT * FROM content_page_revision_localizations ORDER BY id`).toEqual(beforeRows);
  await expect(completeCmsLocales(database.url, { apply: true, actorEmail: "unknown@example.test" })).rejects.toThrow("CMS_ACTOR_NOT_AUTHORIZED");
  const [first, replay] = await Promise.all([
    completeCmsLocales(database.url, { apply: true, actorEmail }),
    completeCmsLocales(database.url, { apply: true, actorEmail })
  ]);
  expect(first.summary.pageTranslations + replay.summary.pageTranslations).toBe(dry.summary.pageTranslations);
  expect(first.summary.collections.length + replay.summary.collections.length).toBe(1);
  const ids = beforeRows.map(row => row.id);
  expect(await sql`SELECT * FROM content_page_revision_localizations WHERE id IN ${sql(ids)} ORDER BY id`).toEqual(beforeRows);
  const afterLanding = await repo.getAdminEditorialCollection("landing");
  expect(afterLanding.published!.id).toBe(beforeLanding.draft!.id);
  expect(afterLanding.draft).toBeNull();
  expect(englishGerman(afterLanding.published!.items)).toEqual(englishGerman(beforeLanding.published!.items));
  const hero = (afterLanding.published as Extract<AdminEditorialRevision, { key: "landing" }>).items.find(item => item.blockType === "hero")!;
  expect(hero.title.fr).toBe("Une rédaction existante");
  const [oldLanding] = await sql`SELECT snapshot FROM content_editorial_revisions WHERE id=${beforeLanding.published!.id}`;
  expect(oldLanding.snapshot).toEqual(beforeLanding.published!.items);
  expect((await repo.getAdminRevision("imprint", "en", { status: "draft" }))?.revision.id).toBe(beforeImprint?.revision.id);
  for (const page of (await repo.listPublishedContentIndex()).pages) {
    expect(page.localizations.map(l => l.locale).sort()).toEqual([...contentUiLocales].sort());
  }
  for (const locale of contentUiLocales) {
    expect((await repo.getPublishedLanding(locale))?.locale).toBe(locale);
    expect((await repo.getPublishedNavigation(locale))?.locale).toBe(locale);
  }
  expect(await repo.hasCurrentAcceptance(actorId)).toBe(true);
  expect(await repo.listOnboardingAcceptances(actorId)).toEqual(acceptances);
  const audit = await sql`SELECT actor_user_id FROM content_admin_events WHERE metadata->>'operation'='missing_localization_added'`;
  expect(audit).toHaveLength(dry.summary.pageTranslations);
  expect(audit.every(row => row.actor_user_id === actorId)).toBe(true);
}, 60000);

it("rejects missing translations before writing anything", async () => {
  await repo.createDraft(actorId, "privacy", new Date().toISOString());
  const source = await repo.getAdminRevision("privacy", "en", { status: "draft" });
  await sql`DELETE FROM content_page_revision_localizations WHERE revision_id=${source!.revision.id} AND locale='uk'`;
  await sql`UPDATE content_page_revision_localizations SET title='An untranslated editorial addition' WHERE revision_id=${source!.revision.id} AND locale='en'`;
  const before = await sql`SELECT * FROM content_page_revision_localizations ORDER BY id`;
  await expect(completeCmsLocales(database.url, { apply: true, actorEmail })).rejects.toThrow("PUBLIC_TRANSLATION_MISSING");
  expect(await sql`SELECT * FROM content_page_revision_localizations ORDER BY id`).toEqual(before);
  expect(() => fillEditorialLocaleGaps({ title: { en: "Unknown editorial text", de: "Existing" } })).toThrow("PUBLIC_TRANSLATION_MISSING");
});
