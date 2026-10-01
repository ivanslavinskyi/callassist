import { describe, expect, it } from "vitest";
import { buildInitialDisclosure, SUPPORTED_CALL_LOCALES } from "@callassist/contracts";
import { initialDisclosureMessages } from "./initial-disclosure-messages";

describe("initial disclosure across interface and call languages", () => {
  it("provides explicit pre-consent wording in all seven interface languages", () => {
    expect(Object.keys(initialDisclosureMessages).sort()).toEqual(["de", "en", "fr", "it", "rm", "ru", "uk"]);
    for (const copy of Object.values(initialDisclosureMessages)) {
      expect(copy.warning.trim()).not.toBe(""); expect(copy.help.trim()).not.toBe("");
      expect(copy.title.trim()).not.toBe(""); expect(copy.unavailable.trim()).not.toBe("");
    }
    expect(initialDisclosureMessages.ru.warning).toContain("до получения согласия");
    expect(initialDisclosureMessages.uk.warning).toContain("до отримання згоди");
  });
  it("keeps the exact script in the call locale independently of interface translations", () => {
    const source = SUPPORTED_CALL_LOCALES.map(locale => buildInitialDisclosure(locale, "Nina Maria Keller-Smith", "female", "language_barrier").text);
    for (const uiLocale of Object.keys(initialDisclosureMessages)) {
      const preview = SUPPORTED_CALL_LOCALES.map(locale => buildInitialDisclosure(locale, "Nina Maria Keller-Smith", "female", "language_barrier").text);
      expect(preview, uiLocale).toEqual(source);
    }
  });
});
