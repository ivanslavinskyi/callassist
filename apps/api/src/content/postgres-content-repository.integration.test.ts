import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PostgresAuthRepository } from "../auth/postgres-auth-repository";
import { runMigrations } from "../db/migrate";
import { PostgresContentRepository } from "./postgres-content-repository";
import { seededContentPages } from "./seed-content";

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
    await expect(contentRepository.getOnboardingStatus(user.id, "de")).resolves
      .toMatchObject({
        required: true,
        current: { terms: { revisionNumber: nextRevisionNumber } },
        accepted: { termsRevisionId: initial.current.terms.id }
      });
  });
});

function phoneFromUuid(value: string) {
  const digits = [...value.replaceAll("-", "").slice(0, 9)]
    .map((digit) => Number.parseInt(digit, 16) % 10)
    .join("");
  return `+417${digits}`;
}
