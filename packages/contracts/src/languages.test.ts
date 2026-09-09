import { describe, expect, it } from "vitest";
import { callLocaleSchema, SELECTABLE_CALL_LANGUAGES } from "./call-brief";
import { languageTagSchema, resolveTaskLanguage, supportedTextLanguage, taskLanguagePreferencesSchema, type CallLanguageContext } from "./languages";

describe("independent language choices", () => {
  it("retains legacy English while exposing only British English for new choices", () => {
    expect(callLocaleSchema.parse("en-US")).toBe("en-US");
    expect(SELECTABLE_CALL_LANGUAGES.filter(x => x.locale.startsWith("en")).map(x => x.locale)).toEqual(["en-GB"]);
  });
  it("normalizes tags without conflating scripts or voice capabilities", () => {
    expect(languageTagSchema.parse("zh-hant")).toBe("zh-Hant");
    expect(supportedTextLanguage("de-CH")).toBe("de");
    expect(supportedTextLanguage("ru-Latn")).toBeNull();
    expect(languageTagSchema.safeParse("Russian language").success).toBe(false);
  });
  it("uses detected request language independently from UI and preserves it across recompilation", () => {
    const first = resolveTaskLanguage({ preferences: { mode: "auto", uiLocaleHint: "en" }, detectedLanguage: "ru", compilationRevision: 1 });
    expect(first).toMatchObject({ taskContentLanguage: "ru", selectionSource: "detection" });
    expect(resolveTaskLanguage({ preferences: { mode: "auto", uiLocaleHint: "de" }, detectedLanguage: "uk", compilationRevision: 2, previous: first })).toMatchObject({ taskContentLanguage: "ru", detectedInputLanguage: "uk", selectionRevision: 1 });
  });
  it("honours manual task preferences and exposes uncertainty", () => {
    expect(resolveTaskLanguage({ preferences: { mode: "manual", targetLanguage: "it" }, accountPreference: "fr", detectedLanguage: "ru", compilationRevision: 1 }).taskContentLanguage).toBe("it");
    expect(resolveTaskLanguage({ detectedLanguage: "und", compilationRevision: 1 })).toMatchObject({ detectionStatus: "undetermined", selectionSource: "default" });
    expect(taskLanguagePreferencesSchema.safeParse({ mode: "auto", targetLanguage: "ru" }).success).toBe(false);
  });
  it.each(["ru", "ru-RU"])("prefers detected %s over the account fallback and interface for a new automatic task", (detectedLanguage) => {
    expect(resolveTaskLanguage({ preferences: { mode: "auto", uiLocaleHint: "de" }, accountPreference: "fr",
      detectedLanguage, compilationRevision: 1 })).toMatchObject({ taskContentLanguage: "ru", selectionSource: "detection", selectionRevision: 1 });
  });
  it.each([undefined, "und", "mul", "pl", "ru-Latn"])("uses the account fallback when detected language %s cannot select a supported text language", (detectedLanguage) => {
    expect(resolveTaskLanguage({ preferences: { mode: "auto", uiLocaleHint: "de" }, accountPreference: "fr",
      detectedLanguage, compilationRevision: 1 })).toMatchObject({ taskContentLanguage: "fr", selectionSource: "account", selectionRevision: 1 });
  });
  it("uses the supported interface language and then English when neither detection nor account can select a target", () => {
    expect(resolveTaskLanguage({ preferences: { mode: "auto", uiLocaleHint: "de-CH" }, accountPreference: null,
      detectedLanguage: "mul", compilationRevision: 1 })).toMatchObject({ taskContentLanguage: "de", selectionSource: "ui_fallback", detectionStatus: "mixed" });
    expect(resolveTaskLanguage({ preferences: { mode: "auto", uiLocaleHint: "pl" }, accountPreference: null,
      detectedLanguage: "und", compilationRevision: 1 })).toMatchObject({ taskContentLanguage: "en", selectionSource: "default", detectionStatus: "undetermined" });
  });
  it.each(["account", "task", "detection", "ui_fallback", "default"] as const)("preserves a saved %s selection under the new automatic precedence", (selectionSource) => {
    const previous: CallLanguageContext = { taskContentLanguage: "fr", selectionSource, selectionRevision: 4,
      detectedInputLanguage: "en", detectionStatus: "detected", compilationRevision: 2 };
    expect(resolveTaskLanguage({ previous, preferences: { mode: "auto", uiLocaleHint: "de" }, accountPreference: "it",
      detectedLanguage: "ru", compilationRevision: 3 })).toEqual({ ...previous, detectedInputLanguage: "ru", compilationRevision: 3 });
    expect(previous).toMatchObject({ detectedInputLanguage: "en", compilationRevision: 2, selectionRevision: 4 });
  });
  it("keeps an explicit correction above saved state and detection, advancing selection revision exactly once", () => {
    const previous: CallLanguageContext = { taskContentLanguage: "fr", selectionSource: "account", selectionRevision: 4,
      detectedInputLanguage: "en", detectionStatus: "detected", compilationRevision: 2 };
    expect(resolveTaskLanguage({ previous, preferences: { mode: "manual", targetLanguage: "uk", uiLocaleHint: "de" },
      accountPreference: "it", detectedLanguage: "ru", compilationRevision: 3 })).toMatchObject({
      taskContentLanguage: "uk", selectionSource: "task", selectionRevision: 5, detectedInputLanguage: "ru", compilationRevision: 3
    });
  });
});
