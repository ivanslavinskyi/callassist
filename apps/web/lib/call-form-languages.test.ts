import type { CreateCallBriefInput } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { normalizeCallFormLanguages } from "./call-form-languages";

describe("editable call languages", () => {
  it("migrates both retired choices without mutating the saved call", () => {
    const form = { locale: "de-DE", fallbackLocale: "en-US", allowLanguageSwitch: true, objective: "Keep my task" } as CreateCallBriefInput;
    expect(normalizeCallFormLanguages(form)).toEqual({ ...form, locale: "de-CH", fallbackLocale: "en-GB" });
    expect(form).toMatchObject({ locale: "de-DE", fallbackLocale: "en-US" });
  });
  it.each([
    { locale: "de-DE", fallbackLocale: "de-CH" },
    { locale: "de-CH", fallbackLocale: "de-DE" },
    { locale: "en-US", fallbackLocale: "en-GB" }
  ] as const)("disables a duplicate fallback after migration: $locale / $fallbackLocale", languages => {
    const normalized = normalizeCallFormLanguages({ ...languages, allowLanguageSwitch: true } as CreateCallBriefInput);
    expect(normalized.allowLanguageSwitch).toBe(false);
    expect(normalized).not.toHaveProperty("fallbackLocale");
  });
  it("preserves an unchanged draft so a pending preparation can be resumed", () => {
    const form = { locale: "de-CH", fallbackLocale: "fr-CH", allowLanguageSwitch: true } as CreateCallBriefInput;
    expect(normalizeCallFormLanguages(form)).toBe(form);
  });
});
