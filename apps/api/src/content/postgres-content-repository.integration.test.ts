import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PostgresAuthRepository } from "../auth/postgres-auth-repository";
import { runMigrations } from "../db/migrate";
import { PostgresContentRepository } from "./postgres-content-repository";
import {
  seededContentPages,
  seededEditorialCollections
} from "./seed-content";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgresContentRepository", () => {
  let authRepository: PostgresAuthRepository;
  let contentRepository: PostgresContentRepository;
  let inspection: postgres.Sql;

  beforeAll(async () => {
    await runMigrations(databaseUrl);
    authRepository = new PostgresAuthRepository(databaseUrl!);
    contentRepository = new PostgresContentRepository(databaseUrl!);
    inspection = postgres(databaseUrl!, { max: 1 });
    await contentRepository.initializeSeedContent(seededContentPages);
    await contentRepository.initializeSeedEditorialCollections(
      seededEditorialCollections
    );
  });

  afterAll(async () => {
    await Promise.all([
      authRepository?.close(),
      contentRepository?.close(),
      inspection?.end()
    ]);
  });

  it("stores immutable acceptance evidence and requires a newly published legal revision", async () => {
    const suffix = randomUUID();
    const user = await authRepository.createUser({
      email: `legal.${suffix}@example.com`,
      passwordHash: "test-password-hash",
      phoneE164: phoneFromUuid(suffix),
      firstName: "Legal",
      lastName: "Reader",
      uiLocale: "de"
    });
    const initial = await contentRepository.getOnboardingStatus(user.id, "de");
    expect(initial).toMatchObject({
      required: true,
      current: {
        terms: { locale: "de" },
        acceptableUse: { locale: "de" }
      },
      accepted: null
    });

    const acceptance = {
      locale: "de" as const,
      termsRevisionId: initial.current.terms.id,
      acceptableUseRevisionId: initial.current.acceptableUse.id,
      acceptTerms: true as const,
      acceptAcceptableUse: true as const,
      acknowledgeConsent: true as const,
      acknowledgeRetention: true as const,
      acknowledgeUseLimits: true as const,
      acknowledgeCredits: true as const
    };
    const acceptedAt = "2026-08-22T12:00:00.000Z";
    await contentRepository.acceptOnboarding(user.id, acceptance, acceptedAt);
    await contentRepository.acceptOnboarding(user.id, acceptance, acceptedAt);

    await expect(contentRepository.hasCurrentAcceptance(user.id)).resolves.toBe(true);
    await expect(contentRepository.getOnboardingStatus(user.id, "en")).resolves
      .toMatchObject({ required: false, accepted: { acceptedAt } });
    const rows = await inspection<{ id: string }[]>`
      SELECT id FROM user_onboarding_acceptances WHERE user_id = ${user.id}
    `;
    expect(rows).toHaveLength(1);
    await expect(inspection`
      UPDATE user_onboarding_acceptances
      SET accepted_locale = 'en'
      WHERE id = ${rows[0]!.id}
    `).rejects.toThrow("immutable");
    await expect(inspection`
      UPDATE content_page_revisions
      SET published_at = now()
      WHERE id = ${initial.current.terms.id}
    `).rejects.toThrow("immutable");
    await expect(inspection`
      UPDATE content_page_revision_localizations
      SET title = 'Changed after publication'
      WHERE revision_id = ${initial.current.terms.id} AND locale = 'en'
    `).rejects.toThrow("immutable");

    const nextRevisionId = randomUUID();
    const nextRevisionNumber = initial.current.terms.revisionNumber + 1;
    const nextRevision = seededContentPages
      .filter(({ key }) => key === "terms")
      .map((page) => ({
        ...page,
        requiresReacceptanceOnUpgrade: true,
        revisionLocalizationId: randomUUID(),
        revision: {
          ...page.revision,
          id: nextRevisionId,
          number: nextRevisionNumber,
          publishedAt: "2026-08-23T00:00:00.000Z"
        }
      }));
    await contentRepository.initializeSeedContent(nextRevision);

    await expect(contentRepository.hasCurrentAcceptance(user.id)).resolves.toBe(false);
    const upgraded = await contentRepository.getOnboardingStatus(user.id, "de");
    expect(upgraded).toMatchObject({
      required: true,
      accepted: { termsRevisionId: initial.current.terms.id }
    });
    expect(upgraded.current.terms.revisionNumber)
      .toBeGreaterThan(initial.current.terms.revisionNumber);
  });

  it("publishes and rolls back through new immutable revisions with append-only audit", async () => {
    const suffix = randomUUID();
    const editor = await authRepository.createUser({
      email: `editor.${suffix}@example.com`,
      passwordHash: "test-password-hash",
      phoneE164: phoneFromUuid(suffix),
      firstName: "Content",
      lastName: "Editor",
      uiLocale: "en"
    });
    await authRepository.markPhoneVerified(editor.id, new Date().toISOString());
    await inspection`
      UPDATE users SET role = 'content_editor' WHERE id = ${editor.id}
    `;

    const pages = await contentRepository.listAdminPages();
    const privacy = pages.find(({ key }) => key === "privacy")!;
    const sourceNumber = privacy.publishedRevision!.number;
    const source = await contentRepository.getAdminRevision(
      "privacy",
      "de",
      { revisionNumber: sourceNumber }
    );
    expect(source).not.toBeNull();
    const englishSource = await contentRepository.getAdminRevision(
      "privacy",
      "en",
      { revisionNumber: sourceNumber }
    );
    expect(englishSource).not.toBeNull();

    const draft = await contentRepository.createDraft(
      editor.id,
      "privacy",
      "2026-08-24T10:00:00.000Z"
    );
    expect(draft).toMatchObject({
      number: sourceNumber + 1,
      status: "draft",
      locales: ["de", "en"]
    });
    await expect(contentRepository.updateDraft(editor.id, "privacy", {
      locale: "en",
      title: englishSource!.title,
      summary: englishSource!.summary,
      sections: englishSource!.sections,
      seoTitle: englishSource!.seoTitle,
      seoDescription: englishSource!.seoDescription,
      sourceRevisionNumber: englishSource!.revision.sourceRevisionNumber,
      requiresReacceptance: false
    }, "2026-08-24T10:02:00.000Z")).resolves.toMatchObject({
      revision: {
        number: sourceNumber + 1,
        sourceRevisionNumber: sourceNumber + 1
      }
    });
    const title = `Datenschutzhinweise ${suffix.slice(0, 8)}`;
    await contentRepository.updateDraft(editor.id, "privacy", {
      locale: "de",
      title,
      summary: source!.summary,
      sections: source!.sections,
      seoTitle: source!.seoTitle,
      seoDescription: source!.seoDescription,
      sourceRevisionNumber: source!.revision.sourceRevisionNumber,
      requiresReacceptance: false
    }, "2026-08-24T10:05:00.000Z");
    await expect(contentRepository.getPublishedPage("de", "datenschutz"))
      .resolves.toMatchObject({ revision: { number: sourceNumber } });

    const published = await contentRepository.publishDraft(
      editor.id,
      "privacy",
      "Publish reviewed integration-test copy",
      "2026-08-24T10:10:00.000Z"
    );
    expect(published).toMatchObject({
      number: sourceNumber + 1,
      status: "published"
    });
    await expect(contentRepository.getPublishedPage("de", "datenschutz"))
      .resolves.toMatchObject({ title, revision: { number: sourceNumber + 1 } });
    const seoIndex = await contentRepository.listPublishedContentIndex();
    const privacyIndex = seoIndex.pages.find(({ key }) => key === "privacy")!;
    expect(privacyIndex.localizations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        locale: "en",
        sourceRevisionNumber: sourceNumber + 1,
        translationStale: false
      }),
      expect.objectContaining({ locale: "de", translationStale: true })
    ]));

    const rollback = await contentRepository.createRollbackDraft(
      editor.id,
      "privacy",
      sourceNumber,
      "Restore previous reviewed revision",
      "2026-08-24T10:15:00.000Z"
    );
    expect(rollback).toMatchObject({
      number: sourceNumber + 2,
      status: "draft"
    });
    await expect(contentRepository.getAdminRevision(
      "privacy",
      "de",
      { status: "draft" }
    )).resolves.toMatchObject({ title: source!.title });
    await contentRepository.publishDraft(
      editor.id,
      "privacy",
      "Publish the reviewed rollback revision",
      "2026-08-24T10:20:00.000Z"
    );

    const events = await inspection<{ eventType: string }[]>`
      SELECT event_type AS "eventType"
      FROM content_admin_events
      WHERE actor_user_id = ${editor.id}
      ORDER BY created_at
    `;
    expect(events.map(({ eventType }) => eventType)).toEqual([
      "content.draft_created",
      "content.draft_updated",
      "content.draft_updated",
      "content.revision_published",
      "content.rollback_draft_created",
      "content.revision_published"
    ]);
    await expect(inspection`
      UPDATE content_admin_events
      SET reason = 'tampered'
      WHERE actor_user_id = ${editor.id}
    `).rejects.toThrow("immutable");
  });

  it("stores FAQ and navigation as immutable audited editorial snapshots", async () => {
    const suffix = randomUUID();
    const editor = await authRepository.createUser({
      email: `editorial.${suffix}@example.com`,
      passwordHash: "test-password-hash",
      phoneE164: phoneFromUuid(suffix),
      firstName: "Editorial",
      lastName: "Editor",
      uiLocale: "en"
    });
    const initial = await contentRepository.getPublishedFaq("de");
    expect(initial).not.toBeNull();
    const draftSummary = await contentRepository.createEditorialDraft(
      editor.id,
      "faq",
      "2026-08-24T11:00:00.000Z"
    );
    const detail = await contentRepository.getAdminEditorialCollection("faq");
    if (detail.draft?.key !== "faq") throw new Error("Expected FAQ draft");
    const targetId = detail.draft.items[0]!.id;
    const targetQuestion = `Integration FAQ revision ${draftSummary.number}`;
    await contentRepository.updateEditorialDraft(editor.id, "faq", {
      key: "faq",
      items: detail.draft.items.map((item) => item.id === targetId
        ? {
            ...item,
            enabled: true,
            question: { ...item.question, de: targetQuestion }
          }
        : item)
    }, "2026-08-24T11:05:00.000Z");
    await expect(contentRepository.getPublishedFaq("de")).resolves.toMatchObject({
      revision: { number: initial!.revision.number }
    });
    await contentRepository.publishEditorialDraft(
      editor.id,
      "faq",
      "Publish reviewed FAQ collection",
      "2026-08-24T11:10:00.000Z"
    );
    const published = await contentRepository.getPublishedFaq("de");
    expect(published).toMatchObject({
      revision: { number: draftSummary.number }
    });
    expect(published!.items.find(({ id }) => id === targetId)?.question).toBe(
      targetQuestion
    );
    await expect(inspection`
      UPDATE content_editorial_revisions
      SET snapshot = '[]'::jsonb
      WHERE id = ${draftSummary.id}
    `).rejects.toThrow("immutable");
    const events = await inspection<{ eventType: string }[]>`
      SELECT event_type AS "eventType"
      FROM content_editorial_admin_events
      WHERE actor_user_id = ${editor.id}
      ORDER BY created_at
    `;
    expect(events.map(({ eventType }) => eventType)).toEqual([
      "editorial.draft_created",
      "editorial.draft_updated",
      "editorial.revision_published"
    ]);
  });

  it("keeps Landing drafts private and publishes their ordered localized SEO snapshot", async () => {
    const suffix = randomUUID();
    const editor = await authRepository.createUser({
      email: `landing.${suffix}@example.com`,
      passwordHash: "test-password-hash",
      phoneE164: phoneFromUuid(suffix),
      firstName: "Landing",
      lastName: "Editor",
      uiLocale: "de"
    });
    const initial = await contentRepository.getPublishedLanding("de");
    expect(initial).not.toBeNull();
    const draftSummary = await contentRepository.createEditorialDraft(
      editor.id,
      "landing",
      "2026-08-24T12:00:00.000Z"
    );
    const detail = await contentRepository.getAdminEditorialCollection("landing");
    if (detail.draft?.key !== "landing") {
      throw new Error("Expected Landing draft");
    }
    const title = `Landing integration revision ${draftSummary.number}`;
    const reordered = [...detail.draft.items];
    [reordered[1], reordered[2]] = [reordered[2]!, reordered[1]!];
    const expectedSecondBlock = reordered[1]!.blockType;
    await contentRepository.updateEditorialDraft(editor.id, "landing", {
      key: "landing",
      items: reordered.map((block, sortOrder) => block.blockType === "hero"
        ? {
            ...block,
            sortOrder,
            seoTitle: { ...block.seoTitle, de: title }
          }
        : { ...block, sortOrder })
    }, "2026-08-24T12:05:00.000Z");
    await expect(contentRepository.getPublishedLanding("de")).resolves
      .toMatchObject({ revision: { number: initial!.revision.number } });
    await contentRepository.publishEditorialDraft(
      editor.id,
      "landing",
      "Publish reviewed Landing collection",
      "2026-08-24T12:10:00.000Z"
    );
    const published = await contentRepository.getPublishedLanding("de");
    expect(published).toMatchObject({
      revision: { number: draftSummary.number },
      seo: { title }
    });
    expect(published?.blocks[1]?.blockType).toBe(expectedSecondBlock);
    const index = await contentRepository.listPublishedContentIndex();
    expect(index.landing).toMatchObject({
      revision: { number: draftSummary.number },
      localizations: expect.arrayContaining([
        expect.objectContaining({
          locale: "de",
          seoTitle: title,
          translationStale: false
        })
      ])
    });
    const events = await inspection<{ eventType: string }[]>`
      SELECT event_type AS "eventType"
      FROM content_editorial_admin_events
      WHERE actor_user_id = ${editor.id}
      ORDER BY created_at
    `;
    expect(events.map(({ eventType }) => eventType)).toEqual([
      "editorial.draft_created",
      "editorial.draft_updated",
      "editorial.revision_published"
    ]);
  });
});

function phoneFromUuid(value: string) {
  const digits = [...value.replaceAll("-", "").slice(0, 9)]
    .map((digit) => Number.parseInt(digit, 16) % 10)
    .join("");
  return `+417${digits}`;
}
