import { describe, expect, it, vi } from "vitest";
import { fetchServerContentPreview } from "./server-admin-content";

describe("server content preview client", () => {
  it("forwards the session without caching the private draft", async () => {
    const page = { key: "privacy", title: "Draft" };
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ page }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));
    await expect(fetchServerContentPreview({
      apiUrl: "http://api.test/",
      cookie: "callassist_session=session-id",
      key: "privacy",
      locale: "de",
      fetcher
    })).resolves.toEqual(page);
    expect(fetcher).toHaveBeenCalledWith(
      "http://api.test/api/admin/content/pages/privacy/preview?locale=de",
      {
        cache: "no-store",
        headers: { cookie: "callassist_session=session-id" }
      }
    );
  });

  it("returns null when no draft exists", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    await expect(fetchServerContentPreview({
      apiUrl: "http://api.test",
      cookie: "",
      key: "faq",
      locale: "en",
      fetcher
    })).resolves.toBeNull();
  });
});
