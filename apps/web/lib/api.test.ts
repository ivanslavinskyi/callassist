import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  acceptOnboarding,
  accessAdminCallSensitiveContent,
  approveAndStartCall,
  changeAdminUserStatus,
  confirmRecipientOptOut,
  createAdminContentDraft,
  createAdminEditorialDraft,
  createCallBrief,
  createPromoCode,
  getCreditUsage,
  getAdminCallInspector,
  getCallOutcome,
  getOnboardingStatus,
  getPublishedContentIndex,
  getPublishedFaq,
  getPublishedLanding,
  getPublishedNavigation,
  getAdminUserCreditLedger,
  getAdminContentPage,
  getAdminEditorialCollection,
  getCallPreparationErrorMessage,
  login,
  listAdminUsers,
  listAdminCalls,
  listAdminContentPages,
  listAdminContentRevisions,
  listAdminEditorialRevisions,
  liftRecipientSuppressionAsStaff,
  logout,
  registerAccount,
  redeemPromoCode,
  publishAdminContentDraft,
  publishAdminEditorialDraft,
  recompileCallBrief,
  requestRecipientOptOut,
  rollbackAdminContentRevision,
  rollbackAdminEditorialRevision,
  grantCreditsAsAdmin,
  revokeAdminUserSessions,
  revokeAllOwnSessions,
  suppressRecipientAsStaff,
  startCall,
  submitCallFeedback,
  updateAdminContentDraft,
  updateAdminEditorialDraft
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API client headers", () => {
  it("loads the public published-content index for SEO consumers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ pages: [], landing: null }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getPublishedContentIndex()).resolves.toEqual({
      pages: [],
      landing: null
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/content/index");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });
  });

  it("uses the protected CMS endpoints for the complete editorial lifecycle", async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ pages: [], revisions: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await listAdminContentPages();
    await getAdminContentPage("privacy", "de");
    await listAdminContentRevisions("privacy");
    await createAdminContentDraft("privacy");
    await updateAdminContentDraft("privacy", {
      locale: "de",
      title: "Datenschutz",
      summary: "Zusammenfassung",
      sections: [{ heading: "Daten", paragraphs: ["Details"], bullets: [] }],
      seoTitle: "Datenschutz",
      seoDescription: "Beschreibung",
      sourceRevisionNumber: 2,
      requiresReacceptance: false
    });
    await publishAdminContentDraft("privacy", "Reviewed privacy update");
    await rollbackAdminContentRevision("privacy", 1, "Restore reviewed revision");

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringMatching(/\/api\/admin\/content\/pages$/),
      expect.stringContaining("/api/admin/content/pages/privacy?locale=de"),
      expect.stringContaining("/api/admin/content/pages/privacy/revisions"),
      expect.stringContaining("/api/admin/content/pages/privacy/drafts"),
      expect.stringContaining("/api/admin/content/pages/privacy/draft"),
      expect.stringContaining("/api/admin/content/pages/privacy/publish"),
      expect.stringContaining("/api/admin/content/pages/privacy/revisions/1/rollback")
    ]);
    expect(fetchMock.mock.calls.slice(3).map(([, init]) => init?.method)).toEqual([
      "POST", "PUT", "POST", "POST"
    ]);
  });

  it("loads public Landing/FAQ/navigation and uses the editorial collection lifecycle", async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({
        faq: { items: [] },
        landing: { blocks: [] },
        navigation: { items: [] },
        published: null,
        draft: null,
        revisions: []
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const id = "72d810e8-106e-4a9d-a49a-9892d860ccbe";

    await getPublishedFaq("de");
    await getPublishedLanding("de");
    await getPublishedNavigation("de");
    await getAdminEditorialCollection("faq");
    await listAdminEditorialRevisions("faq");
    await createAdminEditorialDraft("faq");
    await updateAdminEditorialDraft("faq", {
      key: "faq",
      items: [{
        id,
        sortOrder: 0,
        enabled: true,
        question: { en: "How?", de: "Wie?" },
        answer: { en: "Carefully.", de: "Sorgfältig." }
      }]
    });
    await publishAdminEditorialDraft("faq", "Reviewed FAQ update");
    await rollbackAdminEditorialRevision("faq", 1, "Restore reviewed FAQ");

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining("/api/content/faq?locale=de"),
      expect.stringContaining("/api/content/landing?locale=de"),
      expect.stringContaining("/api/content/navigation?locale=de"),
      expect.stringContaining("/api/admin/content/editorial/faq"),
      expect.stringContaining("/api/admin/content/editorial/faq/revisions"),
      expect.stringContaining("/api/admin/content/editorial/faq/drafts"),
      expect.stringContaining("/api/admin/content/editorial/faq/draft"),
      expect.stringContaining("/api/admin/content/editorial/faq/publish"),
      expect.stringContaining("/api/admin/content/editorial/faq/revisions/1/rollback")
    ]);
  });

  it("does not declare JSON for an empty POST request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ brief: { status: "dialing" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await startCall("call-id");

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).has("Content-Type")).toBe(false);
    expect(request.credentials).toBe("include");
  });

  it("sends registration and login data with credentialed requests", async () => {
    const user = {
      id: "72d810e8-106e-4a9d-a49a-9892d860ccbe",
      email: "nina@example.com",
      phoneE164: "+41791234567",
      phoneVerifiedAt: "2026-08-19T10:00:00.000Z",
      firstName: "Nina",
      lastName: "Keller",
      role: "user",
      status: "active",
      uiLocale: "de",
      createdAt: "2026-08-19T09:00:00.000Z",
      lastLoginAt: "2026-08-19T10:00:00.000Z"
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ status: "verification_required" }),
        { status: 202, headers: { "Content-Type": "application/json" } }
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ user }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ));
    vi.stubGlobal("fetch", fetchMock);

    await registerAccount({
      email: "nina@example.com",
      password: "correct horse battery staple",
      phoneE164: "+41791234567",
      firstName: "Nina",
      lastName: "Keller",
      uiLocale: "de"
    });
    await login({ email: "nina@example.com", password: "correct horse battery staple" });

    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/auth/register");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/api/auth/login");
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).credentials).toBe("include");
      expect(new Headers((call[1] as RequestInit).headers).get("Content-Type")).toBe("application/json");
    }
  });

  it("handles a bodyless logout response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(logout()).resolves.toBeUndefined();

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request).toMatchObject({ method: "POST", credentials: "include" });
    expect(new Headers(request.headers).has("Content-Type")).toBe(false);
  });

  it("revokes all of the current user's sessions with a bodyless request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(revokeAllOwnSessions()).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/auth/sessions/revoke");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request).toMatchObject({ method: "POST", credentials: "include" });
    expect(new Headers(request.headers).has("Content-Type")).toBe(false);
  });

  it("loads authenticated credit usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        balance: 3,
        activeCallBriefId: null,
        transactions: []
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCreditUsage()).resolves.toMatchObject({ balance: 3 });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/usage");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });
  });

  it("loads and accepts the current onboarding revisions", async () => {
    const status = {
      required: true,
      current: {
        terms: { id: "72d810e8-106e-4a9d-a49a-9892d860ccbe" },
        acceptableUse: { id: "4b742964-54b4-457c-a9c6-91b30293189d" }
      },
      accepted: null
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(status), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...status,
        required: false
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
    vi.stubGlobal("fetch", fetchMock);

    await getOnboardingStatus("de");
    await acceptOnboarding({
      locale: "de",
      termsRevisionId: status.current.terms.id,
      acceptableUseRevisionId: status.current.acceptableUse.id,
      acceptTerms: true,
      acceptAcceptableUse: true,
      acknowledgeConsent: true,
      acknowledgeRetention: true,
      acknowledgeUseLimits: true,
      acknowledgeCredits: true
    });

    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/api/onboarding/status?locale=de"
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include"
    });
  });

  it("uses minimized Admin Calls routes and explicit sensitive access", async () => {
    const callId = "72d810e8-106e-4a9d-a49a-9892d860ccbe";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [],
        nextCursor: null
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        summary: { id: callId },
        timeline: [],
        outcomeHistory: []
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        callBriefId: callId,
        phoneNumber: "+41710000000"
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await listAdminCalls({
      limit: 20,
      status: "failed",
      outcome: "unresolved",
      consent: "failed",
      failureStage: "consent",
      locale: "de-CH",
      dateFrom: "2026-08-01T00:00:00.000Z",
      dateTo: "2026-08-31T23:59:59.999Z"
    });
    await getAdminCallInspector(callId);
    await accessAdminCallSensitiveContent(
      callId,
      "Investigating support ticket 123"
    );

    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/api/admin/calls?limit=20&status=failed&outcome=unresolved&consent=failed&failureStage=consent&locale=de-CH&dateFrom=2026-08-01T00%3A00%3A00.000Z&dateTo=2026-08-31T23%3A59%3A59.999Z"
    );
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      `/api/admin/calls/${callId}`
    );
    expect(fetchMock.mock.calls[2]?.[0]).toContain(
      `/api/admin/calls/${callId}/sensitive-access`
    );
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ reason: "Investigating support ticket 123" })
    });
  });

  it("loads filtered admin users and a selected credit ledger", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [],
        nextCursor: null
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: { id: "72d810e8-106e-4a9d-a49a-9892d860ccbe" },
        usage: { balance: 3, activeCallBriefId: null, transactions: [] }
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await listAdminUsers({
      limit: 10,
      search: "nina@example.com",
      role: "user",
      status: "active"
    });
    await getAdminUserCreditLedger(
      "72d810e8-106e-4a9d-a49a-9892d860ccbe"
    );

    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/api/admin/users?limit=10&search=nina%40example.com&role=user&status=active"
    );
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      "/api/admin/users/72d810e8-106e-4a9d-a49a-9892d860ccbe/credits"
    );
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ credentials: "include" });
    }
  });

  it("sends reasoned account status and session actions to the selected user", async () => {
    const userId = "72d810e8-106e-4a9d-a49a-9892d860ccbe";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: { id: userId, status: "suspended" }
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await changeAdminUserStatus(userId, {
      status: "suspended",
      reason: "Repeated abuse reports"
    });
    await revokeAdminUserSessions(userId, {
      reason: "Credential reset requested"
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining(`/api/admin/users/${userId}/status`),
      expect.stringContaining(`/api/admin/users/${userId}/sessions/revoke`)
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "PUT",
      credentials: "include",
      body: JSON.stringify({
        status: "suspended",
        reason: "Repeated abuse reports"
      })
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ reason: "Credential reset requested" })
    });
  });

  it("sends promo redemption, promo creation, and manual grants to dedicated routes", async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({
        applied: true,
        created: true,
        usage: { balance: 4, activeCallBriefId: null, transactions: [] },
        promoCode: {
          id: "72d810e8-106e-4a9d-a49a-9892d860ccbe",
          credits: 1,
          globalRedemptionLimit: 10,
          perUserLimit: 1,
          startsAt: null,
          expiresAt: null,
          active: true,
          campaign: "Beta",
          createdAt: "2026-08-19T10:00:00.000Z"
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const idempotencyKey = "72d810e8-106e-4a9d-a49a-9892d860ccbe";

    await redeemPromoCode({ code: "CALLASSIST25", idempotencyKey });
    await createPromoCode({
      code: "CALLASSIST25",
      credits: 1,
      globalRedemptionLimit: 10,
      perUserLimit: 1,
      startsAt: null,
      expiresAt: null,
      active: true,
      campaign: "Beta",
      reason: "Approved campaign",
      idempotencyKey
    });
    await grantCreditsAsAdmin({
      targetEmail: "user@example.com",
      credits: 1,
      reason: "Support adjustment",
      idempotencyKey
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining("/api/credits/promo-redemptions"),
      expect.stringContaining("/api/admin/promo-codes"),
      expect.stringContaining("/api/admin/credit-grants")
    ]);
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ method: "POST", credentials: "include" });
    }
  });

  it("sends public opt-out and staff suppression actions to dedicated routes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ status: "verification_required" }),
        { status: 202, headers: { "Content-Type": "application/json" } }
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ status: "suppressed" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ status: "suppressed" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ status: "lifted" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ));
    vi.stubGlobal("fetch", fetchMock);

    await requestRecipientOptOut({ phoneE164: "+41791234567" });
    await confirmRecipientOptOut({ phoneE164: "+41791234567", code: "123456" });
    await suppressRecipientAsStaff({
      phoneE164: "+41791234567",
      source: "complaint",
      reason: "Complaint verified by support"
    });
    await liftRecipientSuppressionAsStaff({
      phoneE164: "+41791234567",
      reason: "Recipient consent re-verified"
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining("/api/recipient-opt-out/verification"),
      expect.stringContaining("/api/recipient-opt-out/confirm"),
      expect.stringContaining("/api/admin/recipient-suppressions"),
      expect.stringContaining("/api/admin/recipient-suppressions/lift")
    ]);
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).method).toBe("POST");
      expect((call[1] as RequestInit).credentials).toBe("include");
    }
  });

  it("declares JSON when a request has a body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "call-id" }), {
        status: 201,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await createCallBrief({
      recipientName: "Praxis",
      phoneNumber: "+41710000000",
      objective: "Einen Termin fuer naechste Woche vereinbaren",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "language_barrier",
      locale: "de-CH",
      allowLanguageSwitch: false,
      allowedFacts: []
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).get("Content-Type")).toBe(
      "application/json"
    );
  });

  it("updates a brief with JSON and keeps approve-and-start bodyless", async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ brief: { id: "call-id" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      recipientName: "Elena",
      phoneNumber: "+41710000001",
      objective: "Ask Elena which book she likes most",
      assistantProfileId: "sebastian" as const,
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment" as const,
      locale: "de-CH" as const,
      allowLanguageSwitch: false,
      allowedFacts: []
    };

    await recompileCallBrief("call-id", input);
    await approveAndStartCall("call-id");

    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/call-briefs/call-id");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PUT" });
    expect(
      new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).get(
        "Content-Type"
      )
    ).toBe("application/json");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/approve-and-start");
    expect(
      new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).has(
        "Content-Type"
      )
    ).toBe(false);
  });

  it("loads the private outcome and submits bounded owner feedback", async () => {
    const outcome = {
      technical: {
        connection: "confirmed",
        terminalStatus: "completed",
        consent: "granted",
        recording: "completed",
        transcription: "completed",
        failureStage: null,
        failureCode: null
      },
      latestOutcome: null,
      latestFeedback: null
    };
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify(outcome), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCallOutcome("call-id")).resolves.toEqual(outcome);
    await expect(submitCallFeedback("call-id", {
      idempotencyKey: "f04a1f42-b7ad-4b51-b7bd-6519bd33216f",
      goalResult: "yes",
      transcriptQuality: "good",
      comment: "The appointment was booked."
    })).resolves.toEqual(outcome);

    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/api/call-briefs/call-id/outcome"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include"
    });
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      "/api/call-briefs/call-id/feedback"
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "PUT",
      credentials: "include"
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      idempotencyKey: "f04a1f42-b7ad-4b51-b7bd-6519bd33216f",
      goalResult: "yes",
      transcriptQuality: "good",
      comment: "The appointment was booked."
    });
  });

  it("preserves typed API errors and maps call-planner failures to actionable copy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: "BRIEF_COMPILER_RESPONSE_INVALID" }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      await createCallBrief({
        recipientName: "Elena",
        phoneNumber: "+41710000001",
        objective: "Ask Elena which book she likes most",
        assistantProfileId: "sebastian",
        representedPersonFirstName: "Nina",
        representedPersonLastName: "Keller",
        assistanceReason: "speech_impairment",
        locale: "de-CH",
        allowLanguageSwitch: false,
        allowedFacts: []
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({
      code: "BRIEF_COMPILER_RESPONSE_INVALID",
      status: 502
    });
    expect(getCallPreparationErrorMessage(caught)).toContain("after retrying");
    expect(getCallPreparationErrorMessage(caught)).toContain(
      "entries are preserved"
    );
  });

  it("explains the Swiss-only policy for a legacy start rejection", () => {
    expect(
      getCallPreparationErrorMessage(
        new ApiError("SWISS_DESTINATION_REQUIRED", 422)
      )
    ).toBe(
      "During the public beta CallAssist can only call Swiss phone numbers."
    );
  });

  it("uses localized copy for expensive endpoint rate limits", () => {
    expect(getCallPreparationErrorMessage(
      new ApiError("RATE_LIMITED", 429),
      { rateLimited: "Bitte kurz warten." }
    )).toBe("Bitte kurz warten.");
  });
});
