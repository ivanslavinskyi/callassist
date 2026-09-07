import { describe, expect, it } from "vitest";
import { classifyConsent } from "./consent-classifier";

describe("classifyConsent", () => {
  it.each([
    ["Yes, but I don't agree to recording", "en-GB"],
    ["Ja, aber ohne Aufnahme", "de-CH"],
    ["Да, но запись запрещаю", "ru-RU"],
    ["Yes if you delete it", "en-US"],
    ["Oui mais sans enregistrement", "fr-CH"],
    ["Sì ma senza registrare", "it-CH"],
    ["Ja falls Sie nicht aufnehmen", "de-DE"],
    ["Yes?", "en-GB"],
    ['"Yes"', "en-GB"],
    ["'Yes'", "en-GB"],
    ["You can call but cannot record", "en-GB"],
    ["Да не надо", "ru-RU"]
  ] as const)("never grants qualified or quoted answer %s", (text, locale) => {
    expect(classifyConsent(text, locale)).not.toBe("affirmative");
  });
  it.each([
    ["Ja, gerne.", "de-CH"],
    ["Oui.", "fr-CH"],
    ["Sì, certo.", "it-CH"],
    ["Yes, that's fine.", "en-GB"],
    ["Да, конечно.", "ru-RU"]
  ] as const)("classifies %s as affirmative", (text, locale) => {
    expect(classifyConsent(text, locale)).toBe("affirmative");
  });

  it.each([
    ["Nein, lieber nicht.", "de-DE"],
    ["Je ne suis pas d’accord.", "fr-CH"],
    ["Non voglio.", "it-CH"],
    ["Do not record.", "en-US"],
    ["Нет, не записывайте.", "ru-RU"]
  ] as const)("classifies %s as negative", (text, locale) => {
    expect(classifyConsent(text, locale)).toBe("negative");
  });

  it("gives a negative phrase precedence over an affirmative token", () => {
    expect(classifyConsent("No, okay?", "en-GB")).toBe("negative");
    expect(classifyConsent("Ja, lieber nicht.", "de-CH")).toBe("negative");
  });

  it.each([
    ["Vielleicht", "de-CH"],
    ["Je ne sais pas", "fr-CH"],
    ["What is this about?", "en-US"],
    ["Кто вы?", "ru-RU"]
  ] as const)("fails closed for unclear phrase %s", (text, locale) => {
    expect(classifyConsent(text, locale)).toBe("unclear");
  });
});
