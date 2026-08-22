import { describe, expect, it } from "vitest";
import { buildWebSecurityHeaders } from "./security-headers";

describe("web security headers", () => {
  it("builds a production CSP from origins rather than raw URLs", () => {
    const headers = buildWebSecurityHeaders({
      NODE_ENV: "production",
      NEXT_PUBLIC_API_URL: "https://api.example.test/private/path?secret=yes",
      NEXT_PUBLIC_SITE_URL: "https://www.example.test"
    });
    const values = Object.fromEntries(
      headers.map(({ key, value }) => [key.toLowerCase(), value])
    );

    expect(values["content-security-policy"]).toContain(
      "connect-src 'self' https://api.example.test"
    );
    expect(values["content-security-policy"]).not.toContain("private/path");
    expect(values["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(values["strict-transport-security"]).toBe(
      "max-age=31536000; includeSubDomains"
    );
    expect(values["permissions-policy"]).toContain("microphone=()");
  });

  it("allows local HMR without emitting HSTS in development", () => {
    const headers = buildWebSecurityHeaders({ NODE_ENV: "development" });
    const values = Object.fromEntries(
      headers.map(({ key, value }) => [key.toLowerCase(), value])
    );

    expect(values["content-security-policy"]).toContain("'unsafe-eval'");
    expect(values["content-security-policy"]).toContain("ws://localhost:*");
    expect(values["strict-transport-security"]).toBeUndefined();
  });
});
