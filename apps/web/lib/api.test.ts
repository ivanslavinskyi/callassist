import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  approveAndStartCall,
  createCallBrief,
  getCreditUsage,
  getCallPreparationErrorMessage,
  login,
  logout,
  registerAccount,
  recompileCallBrief,
  startCall
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API client headers", () => {
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
});
