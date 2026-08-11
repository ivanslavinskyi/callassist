import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approveAndStartCall,
  createCallBrief,
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
});
