import { describe, expect, it } from "vitest";
import { normalizeSiteOrigin } from "./site-config";

describe("canonical site origin", () => {
  it("normalizes a plain configured origin", () => {
    expect(normalizeSiteOrigin("https://callassist.example/")).toBe(
      "https://callassist.example"
    );
  });

  it("defaults locally and rejects paths or credentials", () => {
    expect(normalizeSiteOrigin(undefined)).toBe("http://localhost:3000");
    expect(() => normalizeSiteOrigin("https://example.com/public"))
      .toThrow("must not contain a path");
    expect(() => normalizeSiteOrigin("https://user@example.com"))
      .toThrow("plain public origin");
  });
});
