import { describe, expect, it, vi } from "vitest";
import { fetchServerCurrentUser } from "./server-current-user";

const user = {
  id: "72d810e8-106e-4a9d-a49a-9892d860ccbe",
  email: "nina@example.com",
  phoneE164: "+41791234567",
  phoneVerifiedAt: "2026-08-19T10:00:00.000Z",
  firstName: "Nina",
  lastName: "Keller",
  role: "user" as const,
  status: "active" as const,
  uiLocale: "de" as const,
  createdAt: "2026-08-19T09:00:00.000Z",
  lastLoginAt: "2026-08-19T10:00:00.000Z"
};

describe("server-side session lookup", () => {
  it("forwards the request cookie without caching", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ user }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));

    await expect(fetchServerCurrentUser({
      apiUrl: "http://api.internal/",
      cookie: "callassist_session=secret",
      fetcher
    })).resolves.toEqual(user);

    expect(fetcher).toHaveBeenCalledWith(
      "http://api.internal/api/auth/me",
      {
        cache: "no-store",
        headers: { cookie: "callassist_session=secret" }
      }
    );
  });

  it("treats only an explicit unauthorized response as anonymous", async () => {
    const unauthorized = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(fetchServerCurrentUser({
      apiUrl: "http://api.internal",
      cookie: "",
      fetcher: unauthorized
    })).resolves.toBeNull();

    const unavailable = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    await expect(fetchServerCurrentUser({
      apiUrl: "http://api.internal",
      cookie: "",
      fetcher: unavailable
    })).rejects.toThrow("HTTP 503");
  });
});
