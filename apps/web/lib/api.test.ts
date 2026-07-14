import { afterEach, describe, expect, it, vi } from "vitest";
import { createCallBrief, startCall } from "./api";

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
      locale: "de-CH",
      allowLanguageSwitch: false,
      allowedFacts: []
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).get("Content-Type")).toBe(
      "application/json"
    );
  });
});
