import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";
import { uiLocales } from "@callassist/contracts";

describe("OG image routing", () => {
  it("serves fallback and versioned image URLs without locale negotiation or cookies", () => {
    for (const locale of uiLocales) {
      for (const path of [`/og/home/${locale}.png`, `/media/og/home/${locale}/${"a".repeat(64)}.png`]) {
        const response = middleware(new NextRequest(`https://example.com${path}`, { headers: { "Accept-Language": "fr" } }));
        expect(response.headers.get("location")).toBeNull();
        expect(response.headers.get("set-cookie")).toBeNull();
        expect(response.headers.get("x-middleware-next")).toBe("1");
      }
    }
  });
});
