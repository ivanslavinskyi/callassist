import { describe, expect, it, vi } from "vitest";
import {
  fetchServerContentPreview,
  fetchServerEditorialPreview
} from "./server-admin-content";

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

  it("loads a private editorial draft without adding it to a public cache", async () => {
    const draft = { key: "landing", number: 2, items: [] };
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ draft }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));
    await expect(fetchServerEditorialPreview({
      apiUrl: "http://api.test/",
      cookie: "callassist_session=session-id",
      key: "landing",
      fetcher
    })).resolves.toEqual(draft);
    expect(fetcher).toHaveBeenCalledWith(
      "http://api.test/api/admin/content/editorial/landing/preview",
      {
        cache: "no-store",
        headers: { cookie: "callassist_session=session-id" }
      }
    );
  });

  it("does not surface an expected editorial preview authorization response", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(fetchServerEditorialPreview({
      apiUrl: "http://api.test",
      cookie: "",
      key: "landing",
      fetcher
    })).resolves.toBeNull();
  });
});
