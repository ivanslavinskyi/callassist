import { afterEach, describe, expect, it } from "vitest";
import type { User } from "@callassist/contracts";
import { buildApp } from "../app";
import { CallService } from "../call-service";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import type { AuthService } from "../auth/auth-service";
import { InMemoryAuthRepository } from "../auth/in-memory-auth-repository";
import { MemoryOgRepository } from "./og-repository";
import { OgService } from "./og-service";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
async function fixture(role: User["role"] | null = "content_editor") {
  const repository = new InMemoryAuthRepository();
  const user = await repository.createUser({ email: "og-test@example.com", passwordHash: "test", firstName: "OG", lastName: "Editor", uiLocale: "en", phoneE164: "+41710000001" });
  const service = new OgService(new MemoryOgRepository());
  const app = buildApp({ ogService: service, service: new CallService(new InMemoryCallRepository()),
    authService: { repository, authenticate: async () => role ? { ...user, role } : null, close: async () => {} } as unknown as AuthService,
    logger: false, webOrigin: "http://localhost:3000", production: false });
  apps.push(app);
  return { app, service, user };
}
describe("OG authorization and HTTP publication", () => {
  it("rejects anonymous and ordinary user access before decoding uploads", async () => {
    for (const [role, expected] of [[null, 401], ["user", 403]] as const) {
      const { app } = await fixture(role);
      expect((await app.inject({ method: "GET", url: "/api/admin/content/og" })).statusCode).toBe(expected);
      expect((await app.inject({ method: "POST", url: "/api/admin/content/og/en/upload", payload: { image: "invalid" } })).statusCode).toBe(expected);
    }
  });
  it("checks origin, supports editors, and exposes only published immutable bytes", async () => {
    const { app } = await fixture();
    const generate = { method: "POST" as const, url: "/api/admin/content/og/en/generate", payload: { slogan: "No need to talk.", expectedRevision: 0 } };
    expect((await app.inject({ ...generate, headers: { origin: "https://untrusted.example" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/admin/content/og" })).json().locales).toHaveLength(7);
    const response = await app.inject(generate);
    expect(response.statusCode).toBe(200);
    const { draft, revision } = response.json();
    const url = `/api/content/og/en/images/${draft.hash}.png`;
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(404);
    const preview = await app.inject({ method: "GET", url: `/api/admin/content/og/en/images/${draft.hash}.png` });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["cache-control"]).toBe("private, no-store");
    expect((await app.inject({ method: "POST", url: "/api/admin/content/og/en/publish", payload: { versionId: draft.id, expectedRevision: revision } })).statusCode).toBe(200);
    const image = await app.inject({ method: "GET", url });
    expect(image.headers["content-type"]).toBe("image/png");
    expect(image.headers["cache-control"]).toContain("immutable");
    expect((await app.inject({ method: "GET", url, headers: { "if-none-match": image.headers.etag! } })).statusCode).toBe(304);
    expect((await app.inject(generate)).statusCode).toBe(409);
    const published = await app.inject({ method: "GET", url: "/api/content/og" });
    expect(published.headers["cache-control"]).toBe("no-store");
    expect(published.json().images).toEqual([{ locale: "en", hash: draft.hash, alt: "SHPROHLI — No need to talk." }]);
  });
  it("rejects invalid locale, missing image and malformed upload", async () => {
    const { app } = await fixture("admin");
    expect((await app.inject({ method: "POST", url: "/api/admin/content/og/zz/generate", payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/admin/content/og/en/upload", payload: { image: "x" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/api/content/og/en/images/${"f".repeat(64)}.png` })).headers["cache-control"]).toBe("no-store");
  });
});
