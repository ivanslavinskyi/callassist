import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";

afterEach(() => vi.unstubAllEnvs());

describe("admin middleware boundary", () => {
  it.each(["/brand/logo-light.svg", "/brand/logo-dark.svg", "/icon.svg", "/apple-icon.png", "/favicon.ico"])("serves %s without a locale redirect", pathname => {
    const response = middleware(new NextRequest(`https://callassist.test${pathname}`, { headers: { "accept-language": "de" } }));
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.get("callassist_ui_locale")).toBeUndefined();
  });
  it.each(["/admin", "/admin/calls", "/admin/content/editorial"]) (
    "keeps %s outside locale routing",
    (pathname) => {
      const response = middleware(new NextRequest(`https://callassist.test${pathname}`));
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
      expect(response.cookies.get("callassist_ui_locale")).toBeUndefined();
    }
  );

  it("continues to localize public routes", () => {
    const response = middleware(new NextRequest("https://callassist.test/login", {
      headers: { "accept-language": "de-CH,de;q=0.9" }
    }));
    expect(response.headers.get("location")).toBe("https://callassist.test/de/login");
  });

  it("uses the configured public origin for production locale redirects", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://shprohli.ch");
    const response = middleware(new NextRequest("http://localhost:3100/?campaign=beta", {
      headers: {
        "accept-language": "de-CH",
        "host": "localhost:3100",
        "x-forwarded-host": "unexpected.example",
        "x-forwarded-proto": "https"
      }
    }));
    expect(response.headers.get("location")).toBe("https://shprohli.ch/de?campaign=beta");
  });

  it.each(["/en/admin", "/de/admin/calls"]) (
    "does not add compatibility redirects for %s",
    (pathname) => {
      const response = middleware(new NextRequest(`https://callassist.test${pathname}`));
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
  );
});
