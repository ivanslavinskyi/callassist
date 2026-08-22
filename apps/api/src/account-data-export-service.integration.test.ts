import { randomUUID } from "node:crypto";
import {
  normalizeCreateCallBriefInput,
  type CreateCallBriefInput
} from "@callassist/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { AccountDataExportService } from "./account-data-export-service";
import { PostgresAuthRepository } from "./auth/postgres-auth-repository";
import { AuthService, hashSessionToken } from "./auth/auth-service";
import { MockVerificationProvider } from "./auth/verification-provider";
import { DeterministicBriefCompiler } from "./brief-compiler/brief-compiler";
import { ContentService } from "./content/content-service";
import { PostgresContentRepository } from "./content/postgres-content-repository";
import { runMigrations } from "./db/migrate";
import { PostgresCallRepository } from "./storage/postgres-call-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("AccountDataExportService PostgreSQL", () => {
  const encryptionKey = Buffer.alloc(32, 19);
  let authRepository: PostgresAuthRepository;
  let callRepository: PostgresCallRepository;
  let contentRepository: PostgresContentRepository;
  let inspection: postgres.Sql;

  beforeAll(async () => {
    await runMigrations(databaseUrl);
    authRepository = new PostgresAuthRepository(databaseUrl!);
    callRepository = new PostgresCallRepository(databaseUrl!, encryptionKey);
    contentRepository = new PostgresContentRepository(databaseUrl!);
    inspection = postgres(databaseUrl!, { max: 1 });
    await new ContentService(contentRepository).initialize();
  });

  afterAll(async () => {
    await Promise.all([
      authRepository?.close(),
      callRepository?.close(),
      contentRepository?.close(),
      inspection?.end()
    ]);
  });

  it("exports decrypted owner fields while retaining encrypted storage", async () => {
    const suffix = randomUUID();
    const user = await authRepository.createUser({
      email: `export.${suffix}@example.com`,
      passwordHash: "test-only",
      phoneE164: phoneFromUuid(suffix),
      firstName: "Nina",
      lastName: "Keller",
      uiLocale: "de"
    });
    const verified = await authRepository.markPhoneVerified(
      user.id,
      new Date().toISOString()
    );
    await callRepository.grantSignupCredits(user.id);
    const sessionId = randomUUID();
    const token = `export-token-${suffix}`;
    const now = new Date();
    await authRepository.createSession({
      id: sessionId,
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      revokedAt: null,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      userAgent: "Mozilla/5.0 Firefox/141.0 Linux"
    });

    const contentService = new ContentService(contentRepository);
    const onboarding = await contentService.getOnboardingStatus(user.id, "de");
    await contentService.acceptOnboarding(user.id, {
      locale: "de",
      termsRevisionId: onboarding.current.terms.id,
      acceptableUseRevisionId: onboarding.current.acceptableUse.id,
      acceptTerms: true,
      acceptAcceptableUse: true,
      acknowledgeConsent: true,
      acknowledgeRetention: true,
      acknowledgeUseLimits: true,
      acknowledgeCredits: true
    });

    const input: CreateCallBriefInput = {
      recipientName: "Encrypted export clinic",
      phoneNumber: "+41710000008",
      objective: "Ask the clinic for a private appointment next week",
      context: "Sensitive export context 4b1f",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "de-CH",
      allowLanguageSwitch: false,
      allowedFacts: ["Sensitive member number 7c92"]
    };
    const compiler = new DeterministicBriefCompiler();
    const brief = await callRepository.create(
      input,
      await compiler.compile(normalizeCreateCallBriefInput(input)),
      user.id
    );
    const authService = new AuthService({
      repository: authRepository,
      verificationProvider: new MockVerificationProvider(),
      signupCreditGranter: callRepository
    });
    const service = new AccountDataExportService({
      authService,
      callRepository,
      contentRepository
    });

    const exported = await service.generate(
      {
        id: verified.id,
        email: verified.email,
        phoneE164: verified.phoneE164,
        phoneVerifiedAt: verified.phoneVerifiedAt,
        firstName: verified.firstName,
        lastName: verified.lastName,
        role: verified.role,
        status: verified.status,
        uiLocale: verified.uiLocale,
        createdAt: verified.createdAt,
        lastLoginAt: verified.lastLoginAt
      },
      sessionId
    );

    expect(exported.calls).toHaveLength(1);
    expect(exported.calls[0]?.snapshot.brief).toMatchObject({
      id: brief.id,
      allowedFacts: ["Sensitive member number 7c92"]
    });
    expect(exported.calls[0]?.snapshot.brief.context).toContain(
      "Sensitive export context 4b1f"
    );
    expect(exported.onboardingAcceptances).toHaveLength(1);
    expect(exported.activeSessions.sessions[0]).not.toHaveProperty("userAgent");
    expect(exported.activeSessions.sessions[0]).not.toHaveProperty("tokenHash");

    const [stored] = await inspection<{
      contextCiphertext: string;
      allowedFactsCiphertext: string;
    }[]>`
      SELECT
        context_ciphertext AS "contextCiphertext",
        allowed_facts_ciphertext AS "allowedFactsCiphertext"
      FROM call_briefs
      WHERE id = ${brief.id}
    `;
    expect(stored?.contextCiphertext).not.toContain("Sensitive export context");
    expect(stored?.allowedFactsCiphertext).not.toContain("Sensitive member number");
    await expect(inspection`
      SELECT 1
      FROM account_data_export_events
      WHERE id = ${exported.exportId} AND user_id = ${user.id}
    `).resolves.toHaveLength(1);
  });
});

function phoneFromUuid(value: string) {
  const digits = [...value.replaceAll("-", "").slice(0, 8)]
    .map((digit) => Number.parseInt(digit, 16) % 10)
    .join("");
  return `+417${digits}`;
}
