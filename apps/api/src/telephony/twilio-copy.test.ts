import { describe, expect, it } from "vitest";
import type { CallBrief, CallLocale } from "@callassist/contracts";
import { getTwilioCopy } from "./twilio-copy";

const locales: CallLocale[] = [
  "de-CH",
  "de-DE",
  "fr-CH",
  "it-CH",
  "en-GB",
  "en-US",
  "ru-RU"
];

const brief = {
  agentName: "Sebastian",
  representedPerson: "Ivan Slavinskyi",
  voiceGender: "male",
  assistanceDisclosure: "SENSITIVE_ASSISTANCE_REASON",
  audioRetentionDays: 30
} as CallBrief;

describe("getTwilioCopy", () => {
  it.each(locales)("keeps the %s legal disclosure short and separate", (locale) => {
    const copy = getTwilioCopy(locale);
    const disclosure = copy.disclosure(brief);

    expect(disclosure).toContain("Ivan Slavinskyi");
    expect(disclosure).not.toContain("Sebastian");
    expect(disclosure).not.toContain("SENSITIVE_ASSISTANCE_REASON");
    expect(disclosure).not.toContain("30");
    expect(disclosure.toLowerCase()).not.toMatch(/press|drück|appuy|prem|нажм/);
    expect(copy.consentQuestion.trim()).not.toBe("");
    expect(copy.consentQuestion).not.toContain("Ivan Slavinskyi");
  });

  it.each(locales)("provides one explicit %s DTMF fallback", (locale) => {
    expect(getTwilioCopy(locale).dtmfFallback).toMatch(/1/);
  });

  it("uses the selected German grammatical gender without persona identity", () => {
    const female = getTwilioCopy("de-CH").disclosure({
      ...brief,
      voiceGender: "female"
    });

    expect(female).toContain("eine KI-Assistentin");
    expect(female).not.toContain(brief.agentName);
  });
});
