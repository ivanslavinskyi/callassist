import { SELECTABLE_CALL_LANGUAGES, SUPPORTED_CALL_LANGUAGES } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { getCallLanguageLabel } from "./call-language-labels";

describe("call language presentation", () => {
  it("offers one English voice while still resolving a distinct historical US label", () => {
    expect(SELECTABLE_CALL_LANGUAGES.filter(({ locale }) => locale.startsWith("en-"))
      .map(({ locale }) => locale)).toEqual(["en-GB"]);
    expect(getCallLanguageLabel("en-US", "de")).not.toEqual(getCallLanguageLabel("en-GB", "de"));
  });
  it("has German and English names for every current and historical code", () => {
    for (const { locale } of SUPPORTED_CALL_LANGUAGES) {
      expect(getCallLanguageLabel(locale, "de")).toBeTruthy();
      expect(getCallLanguageLabel(locale, "en")).toBeTruthy();
      expect(getCallLanguageLabel(locale, "de")).not.toEqual(getCallLanguageLabel(locale, "en"));
    }
  });
});
