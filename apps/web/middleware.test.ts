import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "./middleware";

describe("admin middleware boundary", () => {
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

  it.each(["/en/admin", "/de/admin/calls"]) (
    "does not add compatibility redirects for %s",
    (pathname) => {
      const response = middleware(new NextRequest(`https://callassist.test${pathname}`));
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
  );
});
