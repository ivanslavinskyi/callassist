import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../app";
import { CallService } from "../call-service";
import { CreditService } from "../credits/credit-service";
import { ContentService } from "../content/content-service";
import { InMemoryContentRepository } from "../content/in-memory-content-repository";
import { seededContentPages } from "../content/seed-content";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { AuthService } from "./auth-service";
import { InMemoryAuthRepository } from "./in-memory-auth-repository";
import { MockVerificationProvider } from "./verification-provider";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createAuthApp(contentService?: ContentService) {
  const repository = new InMemoryAuthRepository();
  const callRepository = new InMemoryCallRepository();
  const callService = new CallService(callRepository);
  const authService = new AuthService({
    repository,
    verificationProvider: new MockVerificationProvider("123456"),
    signupCreditGranter: callService
  });
  const creditService = new CreditService({
    repository: callRepository,
    authRepository: repository,
    hashKey: Buffer.alloc(32, 7)
  });
  const app = buildApp({
    service: callService,
    authService,
    creditService,
    contentService,
    logger: false,
    secureCookies: false
  });
  apps.push(app);
  return { app, repository, callRepository };
}

const registration = {
  email: "nina.keller@example.com",
  password: "a-long-test-password",
  phoneE164: "+41710000000",
  firstName: "Nina",
  lastName: "Keller",
  uiLocale: "de"
};

async function registerAndVerify(
  app: ReturnType<typeof buildApp>,
  input: typeof registration
) {
  const registered = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: input
  });
  expect(registered.statusCode).toBe(202);
  const verified = await app.inject({
    method: "POST",
    url: "/api/auth/verify-phone",
    payload: { email: input.email, code: "123456" }
  });
  expect(verified.statusCode).toBe(200);
  return String(verified.headers["set-cookie"]);
}

const callBrief = {
  recipientName: "Beta Clinic",
  phoneNumber: "+41710000002",
  objective: "Ask for the clinic's opening hours next Monday",
  assistantProfileId: "sebastian",
  representedPersonFirstName: "Nina",
  representedPersonLastName: "Keller",
  assistanceReason: "speech_impairment",
  locale: "de-CH",
  allowLanguageSwitch: false,
  allowedFacts: []
};

describe("auth API", () => {
  it("registers, verifies, creates a server-side session, and logs out", async () => {
    const { app } = createAuthApp();
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: registration
    });
    expect(registered.statusCode).toBe(202);
    expect(registered.json()).toEqual({ status: "verification_required" });

    const beforeVerification = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: registration.email, password: registration.password }
    });
    expect(beforeVerification.statusCode).toBe(403);
    expect(beforeVerification.json()).toEqual({
      error: "PHONE_VERIFICATION_REQUIRED"
    });

    const verified = await app.inject({
      method: "POST",
      url: "/api/auth/verify-phone",
      payload: { email: registration.email, code: "123456" }
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().user).toMatchObject({
      email: registration.email,
      firstName: "Nina",
      lastName: "Keller",
      phoneE164: "+41710000000",
      phoneVerifiedAt: expect.any(String)
    });
    expect(verified.json().user).not.toHaveProperty("passwordHash");
    const cookie = verified.headers["set-cookie"];
    expect(cookie).toContain("callassist_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    const current = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie }
    });
    expect(current.statusCode).toBe(200);
    expect(current.json().user.email).toBe(registration.email);

    const usage = await app.inject({
      method: "GET",
      url: "/api/usage",
      headers: { cookie }
    });
    expect(usage.statusCode).toBe(200);
    expect(usage.json()).toMatchObject({
      balance: 3,
      activeCallBriefId: null,
      transactions: [{ amount: 3, type: "signup_grant" }]
    });

    const verifiedAgain = await app.inject({
      method: "POST",
      url: "/api/auth/verify-phone",
      payload: { email: registration.email, code: "123456" }
    });
    expect(verifiedAgain.statusCode).toBe(200);
    const usageAfterRetry = await app.inject({
      method: "GET",
      url: "/api/usage",
      headers: { cookie: verifiedAgain.headers["set-cookie"] }
    });
    expect(usageAfterRetry.json()).toMatchObject({ balance: 3 });
    expect(usageAfterRetry.json<{ transactions: unknown[] }>().transactions)
      .toHaveLength(1);

    const loggedOut = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie }
    });
    expect(loggedOut.statusCode).toBe(204);
    expect(loggedOut.headers["set-cookie"]).toContain("Max-Age=0");

    const afterLogout = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie }
    });
    expect(afterLogout.statusCode).toBe(401);

    const loggedIn = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: registration.email, password: registration.password }
    });
    expect(loggedIn.statusCode).toBe(200);
    expect(loggedIn.headers["set-cookie"]).toContain("callassist_session=");
  });

  it("lets an authenticated user revoke every active session", async () => {
    const { app } = createAuthApp();
    const firstCookie = await registerAndVerify(app, registration);
    const secondSession = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: registration.email, password: registration.password }
    });
    const secondCookie = String(secondSession.headers["set-cookie"]);

    const anonymous = await app.inject({
      method: "POST",
      url: "/api/auth/sessions/revoke"
    });
    expect(anonymous.statusCode).toBe(401);

    const revoked = await app.inject({
      method: "POST",
      url: "/api/auth/sessions/revoke",
      headers: { cookie: firstCookie }
    });
    expect(revoked.statusCode).toBe(204);
    expect(revoked.headers["set-cookie"]).toContain("Max-Age=0");

    for (const cookie of [firstCookie, secondCookie]) {
      const current = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie }
      });
      expect(current.statusCode).toBe(401);
    }
  });

  it("serves localized policy pages and enforces current onboarding acceptance", async () => {
    const contentRepository = new InMemoryContentRepository();
    const contentService = new ContentService(
      contentRepository,
      () => new Date("2026-08-22T12:00:00.000Z")
    );
    await contentService.initialize();
    const { app } = createAuthApp(contentService);

    const privacy = await app.inject({
      method: "GET",
      url: "/api/content/pages/datenschutz?locale=de"
    });
    expect(privacy.statusCode).toBe(200);
    expect(privacy.json().page).toMatchObject({
      key: "privacy",
      locale: "de",
      revision: { number: 1 }
    });
    const wrongLocale = await app.inject({
      method: "GET",
      url: "/api/content/pages/datenschutz?locale=en"
    });
    expect(wrongLocale.statusCode).toBe(404);
    const contentIndex = await app.inject({
      method: "GET",
      url: "/api/content/index"
    });
    expect(contentIndex.statusCode).toBe(200);
    expect(contentIndex.headers["cache-control"]).toContain("max-age=60");
    expect(contentIndex.json()).toMatchObject({
      landing: {
        revision: { number: 1 },
        localizations: expect.arrayContaining([
          expect.objectContaining({ locale: "de", translationStale: false })
        ])
      },
      pages: expect.arrayContaining([expect.objectContaining({
        key: "privacy",
        localizations: expect.arrayContaining([
          expect.objectContaining({
            locale: "de",
            slug: "datenschutz",
            translationStale: false
          })
        ])
      })])
    });
    const faq = await app.inject({
      method: "GET",
      url: "/api/content/faq?locale=de"
    });
    expect(faq.statusCode).toBe(200);
    expect(faq.json()).toMatchObject({
      faq: {
        revision: { number: 1 },
        items: expect.arrayContaining([
          expect.objectContaining({ question: expect.stringContaining("KI-Anruf") })
        ])
      }
    });
    const landing = await app.inject({
      method: "GET",
      url: "/api/content/landing?locale=de"
    });
    expect(landing.statusCode).toBe(200);
    expect(landing.headers["cache-control"]).toContain("max-age=60");
    expect(landing.json()).toMatchObject({
      landing: {
        locale: "de",
        revision: { number: 1 },
        blocks: [
          { blockType: "hero" },
          { blockType: "how_it_works" },
          { blockType: "use_cases" },
          { blockType: "safety_privacy" },
          { blockType: "languages" },
          { blockType: "faq", itemLimit: 4 },
          { blockType: "cta" }
        ]
      }
    });
    const navigation = await app.inject({
      method: "GET",
      url: "/api/content/navigation?locale=de"
    });
    expect(navigation.statusCode).toBe(200);
    expect(navigation.json()).toMatchObject({
      navigation: {
        items: expect.arrayContaining([
          expect.objectContaining({
            destination: "privacy",
            href: "/de/datenschutz"
          })
        ])
      }
    });

    const cookie = await registerAndVerify(app, registration);
    const blockedBeforeAcceptance = await app.inject({
      method: "GET",
      url: "/api/call-briefs",
      headers: { cookie }
    });
    expect(blockedBeforeAcceptance.statusCode).toBe(403);
    expect(blockedBeforeAcceptance.json()).toEqual({
      error: "ONBOARDING_REQUIRED"
    });

    const status = await app.inject({
      method: "GET",
      url: "/api/onboarding/status?locale=de",
      headers: { cookie }
    });
    expect(status.statusCode).toBe(200);
    const current = status.json().current;
    expect(status.json()).toMatchObject({ required: true, accepted: null });

    const invalid = await app.inject({
      method: "POST",
      url: "/api/onboarding/accept",
      headers: { cookie },
      payload: {
        locale: "de",
        termsRevisionId: current.terms.id,
        acceptableUseRevisionId: current.acceptableUse.id,
        acceptTerms: true,
        acceptAcceptableUse: true,
        acknowledgeConsent: false,
        acknowledgeRetention: true,
        acknowledgeUseLimits: true,
        acknowledgeCredits: true
      }
    });
    expect(invalid.statusCode).toBe(400);

    const stale = await app.inject({
      method: "POST",
      url: "/api/onboarding/accept",
      headers: { cookie },
      payload: {
        locale: "de",
        termsRevisionId: randomUUID(),
        acceptableUseRevisionId: current.acceptableUse.id,
        acceptTerms: true,
        acceptAcceptableUse: true,
        acknowledgeConsent: true,
        acknowledgeRetention: true,
        acknowledgeUseLimits: true,
        acknowledgeCredits: true
      }
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: "LEGAL_REVISION_CHANGED" });

    const acceptance = {
      locale: "de",
      termsRevisionId: current.terms.id,
      acceptableUseRevisionId: current.acceptableUse.id,
      acceptTerms: true,
      acceptAcceptableUse: true,
      acknowledgeConsent: true,
      acknowledgeRetention: true,
      acknowledgeUseLimits: true,
      acknowledgeCredits: true
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const accepted = await app.inject({
        method: "POST",
        url: "/api/onboarding/accept",
        headers: { cookie },
        payload: acceptance
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toMatchObject({ required: false });
    }
    expect(contentRepository.acceptancesForTest()).toHaveLength(1);

    const allowedAfterAcceptance = await app.inject({
      method: "GET",
      url: "/api/call-briefs",
      headers: { cookie }
    });
    expect(allowedAfterAcceptance.statusCode).toBe(200);

    const revisionTwo = seededContentPages
      .filter(({ key }) => key === "acceptable_use")
      .map((page, index) => ({
        ...page,
        revisionLocalizationId: `71000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        revision: {
          ...page.revision,
          id: "72000000-0000-4000-8000-000000000002",
          number: 2,
          publishedAt: "2026-08-23T00:00:00.000Z"
        }
      }));
    await contentRepository.initializeSeedContent(revisionTwo);

    const blockedAfterChange = await app.inject({
      method: "GET",
      url: "/api/call-briefs",
      headers: { cookie }
    });
    expect(blockedAfterChange.statusCode).toBe(403);
    const changedStatus = await app.inject({
      method: "GET",
      url: "/api/onboarding/status?locale=de",
      headers: { cookie }
    });
    expect(changedStatus.json()).toMatchObject({
      required: true,
      current: { acceptableUse: { revisionNumber: 2 } }
    });
  });

  it("scopes content editors to audited CMS drafts and excludes call operations", async () => {
    const contentRepository = new InMemoryContentRepository();
    const contentService = new ContentService(
      contentRepository,
      () => new Date("2026-08-25T12:00:00.000Z")
    );
    await contentService.initialize();
    const { app, repository } = createAuthApp(contentService);
    const cookie = await registerAndVerify(app, registration);

    const onboarding = await app.inject({
      method: "GET",
      url: "/api/onboarding/status?locale=de",
      headers: { cookie }
    });
    const current = onboarding.json().current;
    await app.inject({
      method: "POST",
      url: "/api/onboarding/accept",
      headers: { cookie },
      payload: {
        locale: "de",
        termsRevisionId: current.terms.id,
        acceptableUseRevisionId: current.acceptableUse.id,
        acceptTerms: true,
        acceptAcceptableUse: true,
        acknowledgeConsent: true,
        acknowledgeRetention: true,
        acknowledgeUseLimits: true,
        acknowledgeCredits: true
      }
    });

    const forbiddenUser = await app.inject({
      method: "GET",
      url: "/api/admin/content/pages",
      headers: { cookie }
    });
    expect(forbiddenUser.statusCode).toBe(403);
    expect(forbiddenUser.json()).toEqual({ error: "CONTENT_ACTION_FORBIDDEN" });

    const editor = await repository.findUserByEmail(registration.email);
    await repository.setUserRoleForTest(editor!.id, "content_editor");
    const pages = await app.inject({
      method: "GET",
      url: "/api/admin/content/pages",
      headers: { cookie }
    });
    expect(pages.statusCode).toBe(200);
    expect(pages.json<{ pages: unknown[] }>().pages).toHaveLength(5);

    const blockedCalls = await app.inject({
      method: "GET",
      url: "/api/call-briefs",
      headers: { cookie }
    });
    expect(blockedCalls.statusCode).toBe(403);
    expect(blockedCalls.json()).toEqual({ error: "CALL_ACCESS_FORBIDDEN" });
    const blockedUsers = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { cookie }
    });
    expect(blockedUsers.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/content/pages/privacy/drafts",
      headers: { cookie }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ draft: { number: 2, status: "draft" } });
    const detail = await app.inject({
      method: "GET",
      url: "/api/admin/content/pages/privacy?locale=de",
      headers: { cookie }
    });
    const draft = detail.json().draft;
    const saved = await app.inject({
      method: "PUT",
      url: "/api/admin/content/pages/privacy/draft",
      headers: { cookie },
      payload: {
        locale: "de",
        title: "Datenschutz für die kontrollierte Beta",
        summary: draft.summary,
        sections: draft.sections,
        seoTitle: draft.seoTitle,
        seoDescription: draft.seoDescription,
        sourceRevisionNumber: draft.revision.sourceRevisionNumber,
        requiresReacceptance: false
      }
    });
    expect(saved.statusCode).toBe(200);
    const preview = await app.inject({
      method: "GET",
      url: "/api/admin/content/pages/privacy/preview?locale=de",
      headers: { cookie }
    });
    expect(preview.json()).toMatchObject({
      page: { title: "Datenschutz für die kontrollierte Beta" }
    });
    const publishedBefore = await app.inject({
      method: "GET",
      url: "/api/content/pages/datenschutz?locale=de"
    });
    expect(publishedBefore.json().page.title).toBe("Datenschutzhinweise");

    const published = await app.inject({
      method: "POST",
      url: "/api/admin/content/pages/privacy/publish",
      headers: { cookie },
      payload: { reason: "Publish reviewed German privacy copy" }
    });
    expect(published.statusCode).toBe(200);
    const publishedAfter = await app.inject({
      method: "GET",
      url: "/api/content/pages/datenschutz?locale=de"
    });
    expect(publishedAfter.json()).toMatchObject({
      page: {
        title: "Datenschutz für die kontrollierte Beta",
        revision: { number: 2 }
      }
    });
    const history = await app.inject({
      method: "GET",
      url: "/api/admin/content/pages/privacy/revisions",
      headers: { cookie }
    });
    expect(history.json()).toMatchObject({
      revisions: [
        { number: 2, status: "published" },
        { number: 1, status: "published" }
      ]
    });
    expect(contentRepository.adminEventsForTest().map(({ eventType }) => eventType))
      .toEqual([
        "content.draft_created",
        "content.draft_updated",
        "content.revision_published"
      ]);

    const editorialCreated = await app.inject({
      method: "POST",
      url: "/api/admin/content/editorial/faq/drafts",
      headers: { cookie }
    });
    expect(editorialCreated.statusCode).toBe(201);
    const editorialDetail = await app.inject({
      method: "GET",
      url: "/api/admin/content/editorial/faq",
      headers: { cookie }
    });
    const faqDraft = editorialDetail.json().draft;
    faqDraft.items[0].question.de = "Ist der KI-Anruf offengelegt?";
    const editorialSaved = await app.inject({
      method: "PUT",
      url: "/api/admin/content/editorial/faq/draft",
      headers: { cookie },
      payload: { key: "faq", items: faqDraft.items }
    });
    expect(editorialSaved.statusCode).toBe(200);
    const editorialPublished = await app.inject({
      method: "POST",
      url: "/api/admin/content/editorial/faq/publish",
      headers: { cookie },
      payload: { reason: "Publish reviewed FAQ wording" }
    });
    expect(editorialPublished.statusCode).toBe(200);
    const faqAfter = await app.inject({
      method: "GET",
      url: "/api/content/faq?locale=de"
    });
    expect(faqAfter.json()).toMatchObject({
      faq: {
        revision: { number: 2 },
        items: expect.arrayContaining([
          expect.objectContaining({ question: "Ist der KI-Anruf offengelegt?" })
        ])
      }
    });

    const landingCreated = await app.inject({
      method: "POST",
      url: "/api/admin/content/editorial/landing/drafts",
      headers: { cookie }
    });
    expect(landingCreated.statusCode).toBe(201);
    const landingPreview = await app.inject({
      method: "GET",
      url: "/api/admin/content/editorial/landing/preview",
      headers: { cookie }
    });
    expect(landingPreview.statusCode).toBe(200);
    expect(landingPreview.headers["cache-control"]).toBe("private, no-store");
    expect(landingPreview.json()).toMatchObject({
      draft: {
        key: "landing",
        number: 2,
        items: expect.arrayContaining([
          expect.objectContaining({ blockType: "hero" })
        ])
      }
    });
    const anonymousLandingPreview = await app.inject({
      method: "GET",
      url: "/api/admin/content/editorial/landing/preview"
    });
    expect(anonymousLandingPreview.statusCode).toBe(401);
    const publicLanding = await app.inject({
      method: "GET",
      url: "/api/content/landing?locale=de"
    });
    expect(publicLanding.json()).toMatchObject({
      landing: { revision: { number: 1 } }
    });
  });

  it("requires a session and hides every call resource from other users", async () => {
    const { app, callRepository } = createAuthApp();
    const userACookie = await registerAndVerify(app, registration);
    const userBCookie = await registerAndVerify(app, {
      ...registration,
      email: "leo.meier@example.com",
      phoneE164: "+41710000001",
      firstName: "Leo",
      lastName: "Meier"
    });

    const anonymousList = await app.inject({ method: "GET", url: "/api/call-briefs" });
    expect(anonymousList.statusCode).toBe(401);
    const anonymousUsage = await app.inject({ method: "GET", url: "/api/usage" });
    expect(anonymousUsage.statusCode).toBe(401);

    const invalidOrigin = await app.inject({
      method: "POST",
      url: "/api/call-briefs",
      headers: { cookie: userACookie, origin: "https://attacker.example" },
      payload: callBrief
    });
    expect(invalidOrigin.statusCode).toBe(403);
    expect(invalidOrigin.json()).toEqual({ error: "INVALID_ORIGIN" });

    const created = await app.inject({
      method: "POST",
      url: "/api/call-briefs",
      headers: { cookie: userACookie },
      payload: callBrief
    });
    expect(created.statusCode).toBe(201);
    const callId = created.json<{ id: string }>().id;

    const [userAList, userBList] = await Promise.all([
      app.inject({ method: "GET", url: "/api/call-briefs", headers: { cookie: userACookie } }),
      app.inject({ method: "GET", url: "/api/call-briefs", headers: { cookie: userBCookie } })
    ]);
    expect(userAList.json<{ items: unknown[] }>().items).toHaveLength(1);
    expect(userBList.json<{ items: unknown[] }>().items).toHaveLength(0);

    const crossUserRequests = [
      { method: "GET", url: `/api/call-briefs/${callId}` },
      { method: "PUT", url: `/api/call-briefs/${callId}` },
      { method: "POST", url: `/api/call-briefs/${callId}/approve` },
      { method: "POST", url: `/api/call-briefs/${callId}/approve-and-start` },
      { method: "POST", url: `/api/call-briefs/${callId}/start` },
      { method: "POST", url: `/api/call-briefs/${callId}/stop` },
      { method: "GET", url: `/api/call-briefs/${callId}/recording` },
      { method: "DELETE", url: `/api/call-briefs/${callId}/recording` },
      { method: "POST", url: `/api/call-briefs/${callId}/final-transcript/retry` },
      { method: "GET", url: `/api/call-briefs/${callId}/outcome` },
      { method: "PUT", url: `/api/call-briefs/${callId}/feedback` },
      { method: "POST", url: `/api/call-briefs/${callId}/approvals/00000000-0000-4000-8000-000000000001` },
      { method: "GET", url: `/api/call-briefs/${callId}/events` }
    ] as const;
    for (const request of crossUserRequests) {
      const response = await app.inject({
        method: request.method,
        url: request.url,
        headers: { cookie: userBCookie }
      });
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(404);
      expect(response.json()).toEqual({ error: "CALL_NOT_FOUND" });
    }

    const malformedId = await app.inject({
      method: "GET",
      url: "/api/call-briefs/not-a-uuid",
      headers: { cookie: userACookie }
    });
    expect(malformedId.statusCode).toBe(404);
    expect(malformedId.json()).toEqual({ error: "CALL_NOT_FOUND" });

    const ownerRead = await app.inject({
      method: "GET",
      url: `/api/call-briefs/${callId}`,
      headers: { cookie: userACookie }
    });
    expect(ownerRead.statusCode).toBe(200);

    const approved = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/approve`,
      headers: { cookie: userACookie }
    });
    expect(approved.statusCode).toBe(200);
    const started = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/start`,
      headers: { cookie: userACookie }
    });
    expect(started.statusCode).toBe(200);
    const ownerUsage = await app.inject({
      method: "GET",
      url: "/api/usage",
      headers: { cookie: userACookie }
    });
    expect(ownerUsage.json()).toMatchObject({
      balance: 2,
      activeCallBriefId: callId
    });
    await callRepository.updateStatus(callId, "completed");

    const beforeFeedback = await app.inject({
      method: "GET",
      url: `/api/call-briefs/${callId}/outcome`,
      headers: { cookie: userACookie }
    });
    expect(beforeFeedback.statusCode).toBe(200);
    expect(beforeFeedback.json()).toMatchObject({
      technical: {
        connection: "not_confirmed",
        terminalStatus: "completed"
      },
      latestOutcome: null,
      latestFeedback: null
    });
    const feedback = await app.inject({
      method: "PUT",
      url: `/api/call-briefs/${callId}/feedback`,
      headers: { cookie: userACookie },
      payload: {
        idempotencyKey: randomUUID(),
        goalResult: "yes",
        transcriptQuality: null,
        comment: "Explicit owner assessment"
      }
    });
    expect(feedback.statusCode).toBe(200);
    expect(feedback.json()).toMatchObject({
      latestOutcome: {
        outcome: "resolved",
        provenance: "user"
      },
      latestFeedback: {
        goalResult: "yes",
        comment: "Explicit owner assessment"
      }
    });
    const userMetrics = await app.inject({
      method: "GET",
      url: "/api/admin/call-outcome-metrics",
      headers: { cookie: userACookie }
    });
    expect(userMetrics.statusCode).toBe(403);
    for (const request of [
      { method: "GET", url: "/api/admin/calls" },
      { method: "GET", url: `/api/admin/calls/${callId}` },
      {
        method: "POST",
        url: `/api/admin/calls/${callId}/sensitive-access`,
        payload: { reason: "Unauthorized access test" }
      }
    ] as const) {
      const response = await app.inject({
        ...request,
        headers: { cookie: userACookie }
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it("separates minimized Admin Calls from audited superadmin content access", async () => {
    const { app, repository, callRepository } = createAuthApp();
    const ownerCookie = await registerAndVerify(app, registration);
    const adminRegistration = {
      ...registration,
      email: "call-inspector-admin@example.com",
      phoneE164: "+41710000031",
      firstName: "Ari",
      lastName: "Inspector"
    };
    const adminCookie = await registerAndVerify(app, adminRegistration);
    const adminMe = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: adminCookie }
    });
    const adminId = adminMe.json().user.id as string;
    await repository.setUserRoleForTest(adminId, "admin");

    const created = await app.inject({
      method: "POST",
      url: "/api/call-briefs",
      headers: { cookie: ownerCookie },
      payload: callBrief
    });
    const callId = created.json<{ id: string }>().id;
    await callRepository.updateStatus(callId, "failed");
    await callRepository.recordSystemCallOutcome(callId);

    const invalidQuery = await app.inject({
      method: "GET",
      url: "/api/admin/calls?limit=0",
      headers: { cookie: adminCookie }
    });
    expect(invalidQuery.statusCode).toBe(400);

    const list = await app.inject({
      method: "GET",
      url: "/api/admin/calls?status=failed&locale=de-CH",
      headers: { cookie: adminCookie }
    });
    expect(list.statusCode).toBe(200);
    expect(list.headers["cache-control"]).toBe("private, no-store");
    expect(list.json().items).toEqual([
      expect.objectContaining({ id: callId, status: "failed" })
    ]);
    expect(JSON.stringify(list.json())).not.toContain(callBrief.phoneNumber);
    expect(JSON.stringify(list.json())).not.toContain(callBrief.objective);

    const inspector = await app.inject({
      method: "GET",
      url: `/api/admin/calls/${callId}`,
      headers: { cookie: adminCookie }
    });
    expect(inspector.statusCode).toBe(200);
    expect(inspector.json()).toMatchObject({
      summary: { id: callId },
      timeline: expect.any(Array),
      outcomeHistory: expect.any(Array)
    });
    expect(JSON.stringify(inspector.json())).not.toContain(callBrief.phoneNumber);

    const adminSensitive = await app.inject({
      method: "POST",
      url: `/api/admin/calls/${callId}/sensitive-access`,
      headers: { cookie: adminCookie },
      payload: { reason: "Investigating support ticket 123" }
    });
    expect(adminSensitive.statusCode).toBe(403);
    expect(callRepository.sensitiveCallAccessEventsForTest()).toHaveLength(0);

    await repository.setUserRoleForTest(adminId, "superadmin");
    const invalidReason = await app.inject({
      method: "POST",
      url: `/api/admin/calls/${callId}/sensitive-access`,
      headers: { cookie: adminCookie },
      payload: { reason: "x" }
    });
    expect(invalidReason.statusCode).toBe(400);

    const sensitive = await app.inject({
      method: "POST",
      url: `/api/admin/calls/${callId}/sensitive-access`,
      headers: { cookie: adminCookie },
      payload: { reason: "Investigating support ticket 123" }
    });
    expect(sensitive.statusCode).toBe(200);
    expect(sensitive.json()).toMatchObject({
      callBriefId: callId,
      phoneNumber: callBrief.phoneNumber,
      objective: expect.any(String)
    });
    expect(callRepository.sensitiveCallAccessEventsForTest()).toEqual([
      expect.objectContaining({
        callBriefId: callId,
        actorUserId: adminId,
        reason: "Investigating support ticket 123"
      })
    ]);
  });

  it("uses a generic response for duplicate registration and generic login errors", async () => {
    const { app } = createAuthApp();
    const first = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: registration
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: registration
    });
    expect(duplicate.statusCode).toBe(first.statusCode);
    expect(duplicate.json()).toEqual(first.json());

    const invalid = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: registration.email, password: "wrong-password" }
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json()).toEqual({ error: "INVALID_CREDENTIALS" });
  });

  it("requires both registration name fields and rejects foreign browser origins", async () => {
    const { app } = createAuthApp();
    const { lastName: _lastName, ...withoutLastName } = registration;
    const invalid = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: withoutLastName
    });
    expect(invalid.statusCode).toBe(400);

    const foreignOrigin = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { origin: "https://attacker.example" },
      payload: registration
    });
    expect(foreignOrigin.statusCode).toBe(403);
    expect(foreignOrigin.json()).toEqual({ error: "INVALID_ORIGIN" });
  });

  it("returns explicit API errors for recipient suppression and the global kill switch", async () => {
    const { app, callRepository } = createAuthApp();
    const cookie = await registerAndVerify(app, registration);
    const created = await app.inject({
      method: "POST",
      url: "/api/call-briefs",
      headers: { cookie },
      payload: callBrief
    });
    const callId = created.json<{ id: string }>().id;
    await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/approve`,
      headers: { cookie }
    });

    await callRepository.suppressRecipient({
      phoneE164: callBrief.phoneNumber,
      source: "recipient_request",
      reason: "Recipient requested no further calls"
    });
    const suppressed = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/start`,
      headers: { cookie }
    });
    expect(suppressed.statusCode).toBe(403);
    expect(suppressed.json()).toEqual({ error: "RECIPIENT_SUPPRESSED" });

    await callRepository.liftRecipientSuppression(callBrief.phoneNumber, {
      reason: "Recipient withdrew the suppression request"
    });
    await callRepository.setOutboundCallsEnabled(false, {
      reason: "Emergency pause test"
    });
    const disabled = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/start`,
      headers: { cookie }
    });
    expect(disabled.statusCode).toBe(503);
    expect(disabled.json()).toEqual({ error: "OUTBOUND_CALLS_DISABLED" });

    await callRepository.setOutboundCallsEnabled(true, {
      reason: "Emergency pause cleared"
    });
    const started = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/start`,
      headers: { cookie }
    });
    expect(started.statusCode).toBe(200);
  });

  it("accepts a public opt-out only after SMS proof and blocks future calls", async () => {
    const { app, callRepository } = createAuthApp();
    const invalid = await app.inject({
      method: "POST",
      url: "/api/recipient-opt-out/verification",
      payload: { phoneE164: "not-a-phone" }
    });
    expect(invalid.statusCode).toBe(400);

    const foreignOrigin = await app.inject({
      method: "POST",
      url: "/api/recipient-opt-out/verification",
      headers: { origin: "https://attacker.example" },
      payload: { phoneE164: callBrief.phoneNumber }
    });
    expect(foreignOrigin.statusCode).toBe(403);

    const requested = await app.inject({
      method: "POST",
      url: "/api/recipient-opt-out/verification",
      payload: { phoneE164: callBrief.phoneNumber }
    });
    expect(requested.statusCode).toBe(202);
    expect(requested.json()).toEqual({ status: "verification_required" });

    const rejected = await app.inject({
      method: "POST",
      url: "/api/recipient-opt-out/confirm",
      payload: { phoneE164: callBrief.phoneNumber, code: "999999" }
    });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json()).toEqual({ error: "INVALID_OPT_OUT_VERIFICATION" });

    const confirmed = await app.inject({
      method: "POST",
      url: "/api/recipient-opt-out/confirm",
      payload: { phoneE164: callBrief.phoneNumber, code: "123456" }
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toEqual({ status: "suppressed" });
    expect(callRepository.safetyEventsForTest()).toContainEqual({
      eventType: "recipient.suppressed",
      actorUserId: null,
      phoneE164: callBrief.phoneNumber,
      source: "recipient_request",
      reason: "Recipient confirmed public opt-out by SMS"
    });

    const cookie = await registerAndVerify(app, registration);
    const created = await app.inject({
      method: "POST",
      url: "/api/call-briefs",
      headers: { cookie },
      payload: callBrief
    });
    const callId = created.json<{ id: string }>().id;
    await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/approve`,
      headers: { cookie }
    });
    const blocked = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/start`,
      headers: { cookie }
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toEqual({ error: "RECIPIENT_SUPPRESSED" });
  });

  it("allows only administrators to suppress or lift recipients as staff", async () => {
    const { app, repository, callRepository } = createAuthApp();
    const adminRegistration = {
      ...registration,
      email: "safety-admin@example.com",
      phoneE164: "+41710000005"
    };
    const adminCookie = await registerAndVerify(app, adminRegistration);
    const userCookie = await registerAndVerify(app, registration);
    const [adminMe, userMe] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie: adminCookie }
      }),
      app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie: userCookie }
      })
    ]);
    const adminId = adminMe.json().user.id as string;
    await repository.setUserRoleForTest(adminId, "admin");
    await repository.setUserRoleForTest(userMe.json().user.id, "support");

    const forbidden = await app.inject({
      method: "POST",
      url: "/api/admin/recipient-suppressions",
      headers: { cookie: userCookie },
      payload: {
        phoneE164: callBrief.phoneNumber,
        source: "staff",
        reason: "Support request received"
      }
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ error: "ADMIN_ACTION_FORBIDDEN" });

    const suppressed = await app.inject({
      method: "POST",
      url: "/api/admin/recipient-suppressions",
      headers: { cookie: adminCookie },
      payload: {
        phoneE164: callBrief.phoneNumber,
        source: "complaint",
        reason: "Complaint verified by support"
      }
    });
    expect(suppressed.statusCode).toBe(200);
    expect(suppressed.json()).toEqual({ status: "suppressed" });
    const duplicateSuppression = await app.inject({
      method: "POST",
      url: "/api/admin/recipient-suppressions",
      headers: { cookie: adminCookie },
      payload: {
        phoneE164: callBrief.phoneNumber,
        source: "staff",
        reason: "Duplicate operator request"
      }
    });
    expect(duplicateSuppression.json()).toEqual({
      status: "already_suppressed"
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/call-briefs",
      headers: { cookie: userCookie },
      payload: callBrief
    });
    const callId = created.json<{ id: string }>().id;
    await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/approve`,
      headers: { cookie: userCookie }
    });
    expect((await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/start`,
      headers: { cookie: userCookie }
    })).statusCode).toBe(403);

    const lifted = await app.inject({
      method: "POST",
      url: "/api/admin/recipient-suppressions/lift",
      headers: { cookie: adminCookie },
      payload: {
        phoneE164: callBrief.phoneNumber,
        reason: "Recipient identity and consent re-verified"
      }
    });
    expect(lifted.statusCode).toBe(200);
    expect(lifted.json()).toEqual({ status: "lifted" });
    const duplicateLift = await app.inject({
      method: "POST",
      url: "/api/admin/recipient-suppressions/lift",
      headers: { cookie: adminCookie },
      payload: {
        phoneE164: callBrief.phoneNumber,
        reason: "Duplicate lift request"
      }
    });
    expect(duplicateLift.json()).toEqual({ status: "not_suppressed" });
    expect(callRepository.safetyEventsForTest().slice(-2)).toEqual([
      {
        eventType: "recipient.suppressed",
        actorUserId: adminId,
        phoneE164: callBrief.phoneNumber,
        source: "complaint",
        reason: "Complaint verified by support"
      },
      {
        eventType: "recipient.suppression_lifted",
        actorUserId: adminId,
        phoneE164: callBrief.phoneNumber,
        reason: "Recipient identity and consent re-verified"
      }
    ]);
    expect((await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/start`,
      headers: { cookie: userCookie }
    })).statusCode).toBe(200);
  });

  it("rejects an incorrect SMS verification code without creating a session", async () => {
    const { app } = createAuthApp();
    await app.inject({ method: "POST", url: "/api/auth/register", payload: registration });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/verify-phone",
      payload: { email: registration.email, code: "999999" }
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "INVALID_VERIFICATION" });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("invalidates an existing session when the account is suspended", async () => {
    const { app, repository } = createAuthApp();
    await app.inject({ method: "POST", url: "/api/auth/register", payload: registration });
    const verified = await app.inject({
      method: "POST",
      url: "/api/auth/verify-phone",
      payload: { email: registration.email, code: "123456" }
    });
    const userId = verified.json().user.id as string;
    const cookie = verified.headers["set-cookie"];
    await repository.setUserStatusForTest(userId, "suspended");

    const current = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie }
    });
    expect(current.statusCode).toBe(401);
  });

  it("restricts audited suspend, unsuspend, and force logout actions to administrators", async () => {
    const { app, repository } = createAuthApp();
    const adminRegistration = {
      ...registration,
      email: "admin@example.com",
      phoneE164: "+41710000003",
      firstName: "Ada",
      lastName: "Admin"
    };
    const targetRegistration = {
      ...registration,
      email: "target@example.com",
      phoneE164: "+41710000004",
      firstName: "Tara",
      lastName: "Target"
    };
    const adminCookie = await registerAndVerify(app, adminRegistration);
    const targetCookie = await registerAndVerify(app, targetRegistration);
    const adminMe = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: adminCookie }
    });
    const targetMe = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: targetCookie }
    });
    const adminId = adminMe.json().user.id as string;
    const targetId = targetMe.json().user.id as string;
    await repository.setUserRoleForTest(adminId, "admin");

    const outcomeMetrics = await app.inject({
      method: "GET",
      url: "/api/admin/call-outcome-metrics",
      headers: { cookie: adminCookie }
    });
    expect(outcomeMetrics.statusCode).toBe(200);
    expect(outcomeMetrics.headers["cache-control"]).toBe("private, no-store");
    expect(outcomeMetrics.json()).toMatchObject({
      terminalCalls: 0,
      feedbackResponses: 0,
      goalResults: { yes: 0, partly: 0, no: 0 }
    });

    await repository.setUserRoleForTest(targetId, "support");
    const privilegedTargetAction = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${targetId}/status`,
      headers: { cookie: adminCookie },
      payload: { status: "suspended", reason: "Privilege boundary test" }
    });
    expect(privilegedTargetAction.statusCode).toBe(403);
    expect(privilegedTargetAction.json()).toEqual({
      error: "ADMIN_ACTION_FORBIDDEN"
    });
    await repository.setUserRoleForTest(targetId, "user");

    const secondTargetLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: targetRegistration.email,
        password: targetRegistration.password
      }
    });
    const secondTargetCookie = String(secondTargetLogin.headers["set-cookie"]);

    const foreignOriginAction = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${targetId}/status`,
      headers: { cookie: adminCookie, origin: "https://attacker.example" },
      payload: { status: "suspended", reason: "Cross-site action test" }
    });
    expect(foreignOriginAction.statusCode).toBe(403);
    expect(foreignOriginAction.json()).toEqual({ error: "INVALID_ORIGIN" });

    const nonAdminAction = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${adminId}/status`,
      headers: { cookie: targetCookie },
      payload: { status: "suspended", reason: "Unauthorized attempt" }
    });
    expect(nonAdminAction.statusCode).toBe(403);
    expect(nonAdminAction.json()).toEqual({ error: "ADMIN_ACTION_FORBIDDEN" });

    const suspended = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${targetId}/status`,
      headers: { cookie: adminCookie },
      payload: { status: "suspended", reason: "Repeated abuse reports" }
    });
    expect(suspended.statusCode).toBe(200);
    expect(suspended.json().user).toMatchObject({
      id: targetId,
      status: "suspended"
    });
    expect(suspended.json().user).not.toHaveProperty("passwordHash");
    for (const cookie of [targetCookie, secondTargetCookie]) {
      const current = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie }
      });
      expect(current.statusCode).toBe(401);
    }
    const suspendedLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: targetRegistration.email,
        password: targetRegistration.password
      }
    });
    expect(suspendedLogin.statusCode).toBe(403);
    expect(suspendedLogin.json()).toEqual({ error: "ACCOUNT_SUSPENDED" });

    const duplicateSuspension = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${targetId}/status`,
      headers: { cookie: adminCookie },
      payload: { status: "suspended", reason: "Duplicate action" }
    });
    expect(duplicateSuspension.statusCode).toBe(409);
    expect(duplicateSuspension.json()).toEqual({
      error: "ACCOUNT_STATUS_UNCHANGED"
    });

    const unsuspended = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${targetId}/status`,
      headers: { cookie: adminCookie },
      payload: { status: "active", reason: "Review completed" }
    });
    expect(unsuspended.statusCode).toBe(200);
    expect(unsuspended.json().user.status).toBe("active");
    const oldSessionAfterUnsuspend = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: targetCookie }
    });
    expect(oldSessionAfterUnsuspend.statusCode).toBe(401);

    const freshLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: targetRegistration.email,
        password: targetRegistration.password
      }
    });
    expect(freshLogin.statusCode).toBe(200);
    const freshCookie = String(freshLogin.headers["set-cookie"]);
    const forceLogout = await app.inject({
      method: "POST",
      url: `/api/admin/users/${targetId}/sessions/revoke`,
      headers: { cookie: adminCookie },
      payload: { reason: "Credential reset requested" }
    });
    expect(forceLogout.statusCode).toBe(204);
    const afterForceLogout = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: freshCookie }
    });
    expect(afterForceLogout.statusCode).toBe(401);

    const selfSuspension = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${adminId}/status`,
      headers: { cookie: adminCookie },
      payload: { status: "suspended", reason: "Self action test" }
    });
    expect(selfSuspension.statusCode).toBe(403);
    expect(selfSuspension.json()).toEqual({
      error: "SELF_ADMIN_ACTION_FORBIDDEN"
    });

    expect(repository.accountAdminEventsForTest()).toMatchObject([
      {
        eventType: "account.suspended",
        actorUserId: adminId,
        targetUserId: targetId,
        reason: "Repeated abuse reports"
      },
      {
        eventType: "account.unsuspended",
        actorUserId: adminId,
        targetUserId: targetId,
        reason: "Review completed"
      },
      {
        eventType: "account.sessions_revoked",
        actorUserId: adminId,
        targetUserId: targetId,
        reason: "Credential reset requested"
      }
    ]);
  });

  it("creates and redeems promo codes exactly once without storing the raw code in usage", async () => {
    const { app, repository } = createAuthApp();
    const adminRegistration = {
      ...registration,
      email: "credits-admin@example.com",
      phoneE164: "+41710000008"
    };
    const userRegistration = {
      ...registration,
      email: "promo-user@example.com",
      phoneE164: "+41710000009"
    };
    const adminCookie = await registerAndVerify(app, adminRegistration);
    const userCookie = await registerAndVerify(app, userRegistration);
    const admin = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: adminCookie }
    });
    await repository.setUserRoleForTest(admin.json().user.id, "admin");

    const forbidden = await app.inject({
      method: "POST",
      url: "/api/admin/promo-codes",
      headers: { cookie: userCookie },
      payload: promoCreation("CALLASSIST25")
    });
    expect(forbidden.statusCode).toBe(403);

    const creation = promoCreation("CALLASSIST25");
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/promo-codes",
      headers: { cookie: adminCookie },
      payload: creation
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      created: true,
      promoCode: { credits: 5, campaign: "Beta launch" }
    });
    expect(JSON.stringify(created.json())).not.toContain("CALLASSIST25");

    const idempotencyKey = randomUUID();
    const redeem = () => app.inject({
      method: "POST",
      url: "/api/credits/promo-redemptions",
      headers: { cookie: userCookie },
      payload: { code: "callassist25", idempotencyKey }
    });
    const first = await redeem();
    const replay = await redeem();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ applied: true, usage: { balance: 8 } });
    expect(replay.json()).toMatchObject({ applied: false, usage: { balance: 8 } });
    expect(first.json().usage.transactions).toContainEqual(expect.objectContaining({
      type: "promo_grant",
      amount: 5,
      promoRedemptionId: expect.any(String)
    }));
    expect(JSON.stringify(first.json())).not.toContain("CALLASSIST25");

    const overLimit = await app.inject({
      method: "POST",
      url: "/api/credits/promo-redemptions",
      headers: { cookie: userCookie },
      payload: { code: "CALLASSIST25", idempotencyKey: randomUUID() }
    });
    expect(overLimit.statusCode).toBe(409);
    expect(overLimit.json()).toEqual({ error: "PROMO_USER_LIMIT_REACHED" });
  });

  it("records idempotent administrator credit grants with actor and reason", async () => {
    const { app, repository } = createAuthApp();
    const adminRegistration = {
      ...registration,
      email: "grant-admin@example.com",
      phoneE164: "+41710000010"
    };
    const targetRegistration = {
      ...registration,
      email: "grant-target@example.com",
      phoneE164: "+41710000011"
    };
    const adminCookie = await registerAndVerify(app, adminRegistration);
    const targetCookie = await registerAndVerify(app, targetRegistration);
    const admin = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: adminCookie }
    });
    const adminId = admin.json().user.id as string;
    await repository.setUserRoleForTest(adminId, "admin");
    const idempotencyKey = randomUUID();
    const payload = {
      targetEmail: targetRegistration.email,
      credits: 4,
      reason: "Customer recovery adjustment",
      idempotencyKey
    };
    const grant = () => app.inject({
      method: "POST",
      url: "/api/admin/credit-grants",
      headers: { cookie: adminCookie },
      payload
    });
    const first = await grant();
    const replay = await grant();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ applied: true, usage: { balance: 7 } });
    expect(replay.json()).toMatchObject({ applied: false, usage: { balance: 7 } });

    const usage = await app.inject({
      method: "GET",
      url: "/api/usage",
      headers: { cookie: targetCookie }
    });
    expect(usage.json().transactions).toContainEqual(expect.objectContaining({
      type: "admin_grant",
      amount: 4,
      adminId,
      reason: payload.reason
    }));

    const selfGrant = await app.inject({
      method: "POST",
      url: "/api/admin/credit-grants",
      headers: { cookie: adminCookie },
      payload: { ...payload, targetEmail: adminRegistration.email, idempotencyKey: randomUUID() }
    });
    expect(selfGrant.statusCode).toBe(403);
    expect(selfGrant.json()).toEqual({ error: "CREDIT_SELF_GRANT_FORBIDDEN" });
  });

  it("lets administrators search eligible users and inspect their credit ledger", async () => {
    const { app, repository } = createAuthApp();
    const adminRegistration = {
      ...registration,
      email: "lookup-admin@example.com",
      phoneE164: "+41710000012"
    };
    const targetRegistration = {
      ...registration,
      email: "ledger-target@example.com",
      phoneE164: "+41710000013",
      firstName: "Ledger",
      lastName: "Target"
    };
    const staffRegistration = {
      ...registration,
      email: "hidden-support@example.com",
      phoneE164: "+41710000014"
    };
    const adminCookie = await registerAndVerify(app, adminRegistration);
    const targetCookie = await registerAndVerify(app, targetRegistration);
    const staffCookie = await registerAndVerify(app, staffRegistration);
    const [admin, target, staff] = await Promise.all(
      [adminCookie, targetCookie, staffCookie].map((cookie) => app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie }
      }))
    );
    const adminId = admin.json().user.id as string;
    const targetId = target.json().user.id as string;
    const staffId = staff.json().user.id as string;
    await repository.setUserRoleForTest(adminId, "admin");
    await repository.setUserRoleForTest(staffId, "support");

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { cookie: targetCookie }
    });
    expect(forbidden.statusCode).toBe(403);

    const invalid = await app.inject({
      method: "GET",
      url: "/api/admin/users?limit=500",
      headers: { cookie: adminCookie }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: "INVALID_ADMIN_USER_QUERY" });

    const found = await app.inject({
      method: "GET",
      url: "/api/admin/users?search=ledger-target&status=active",
      headers: { cookie: adminCookie }
    });
    expect(found.statusCode).toBe(200);
    expect(found.headers["cache-control"]).toBe("private, no-store");
    expect(found.json().items).toEqual([
      expect.objectContaining({
        id: targetId,
        email: targetRegistration.email,
        firstName: "Ledger",
        lastName: "Target",
        phoneVerified: true
      })
    ]);
    expect(found.json().items[0]).not.toHaveProperty("phoneE164");
    expect(found.json().items[0]).not.toHaveProperty("passwordHash");

    const ledger = await app.inject({
      method: "GET",
      url: `/api/admin/users/${targetId}/credits`,
      headers: { cookie: adminCookie }
    });
    expect(ledger.statusCode).toBe(200);
    expect(ledger.json()).toMatchObject({
      user: { id: targetId, email: targetRegistration.email },
      usage: { balance: 3 }
    });
    expect(ledger.json().usage.transactions).toContainEqual(
      expect.objectContaining({ type: "signup_grant", amount: 3 })
    );

    const hiddenStaff = await app.inject({
      method: "GET",
      url: `/api/admin/users/${staffId}/credits`,
      headers: { cookie: adminCookie }
    });
    expect(hiddenStaff.statusCode).toBe(404);
    expect(hiddenStaff.json()).toEqual({ error: "USER_NOT_FOUND" });

    await repository.setUserRoleForTest(adminId, "superadmin");
    const privileged = await app.inject({
      method: "GET",
      url: "/api/admin/users?role=support",
      headers: { cookie: adminCookie }
    });
    expect(privileged.statusCode).toBe(200);
    expect(privileged.json().items).toContainEqual(
      expect.objectContaining({ id: staffId, role: "support" })
    );
  });
});

function promoCreation(code: string) {
  return {
    code,
    credits: 5,
    globalRedemptionLimit: 10,
    perUserLimit: 1,
    startsAt: null,
    expiresAt: null,
    active: true,
    campaign: "Beta launch",
    reason: "Approved beta campaign",
    idempotencyKey: randomUUID()
  };
}
