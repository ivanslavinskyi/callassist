import { expect, it } from "vitest";
import { uiLocales } from "@callassist/contracts";
import { voiceConsentMessages } from "./voice-consent-messages";

it.each(uiLocales)("provides complete consent settings copy for %s", locale => {
  const copy = voiceConsentMessages[locale];
  expect(Object.keys(copy).sort()).toEqual(Object.keys(voiceConsentMessages.en).sort());
  expect(Object.values(copy).every(value => value.trim().length > 0)).toBe(true);
  if (locale !== "en") {
    expect(copy.scope).not.toBe(voiceConsentMessages.en.scope);
    expect(copy.hybridHelp).not.toBe(voiceConsentMessages.en.hybridHelp);
    expect(copy.stale).not.toBe(voiceConsentMessages.en.stale);
  }
});
