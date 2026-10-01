import { describe, expect, it } from "vitest";
import { createSpokenIdentities, projectSpokenIdentityText, spokenIdentityName } from "./spoken-identities";

describe("spoken identities", () => {
  it.each(["de-CH", "de-DE", "en-GB", "fr-CH", "it-CH"])("keeps original spelling and provides Cyrillic pronunciation spelling for %s", locale => {
    const names = createSpokenIdentities(locale, "Иван", "Юлия Петрова");
    expect(names.recipient).toEqual({ original: "Иван", spoken: "Ivan" });
    expect(names.representedPerson).toEqual({ original: "Юлия Петрова", spoken: "Yuliya Petrova" });
    expect(projectSpokenIdentityText("Иван möchte Pizza. Юлия Петрова fragt nach.", names)).toBe("Ivan möchte Pizza. Yuliya Petrova fragt nach.");
  });
  it("leaves Russian calls, Latin names and non-identity prose unchanged", () => {
    expect(spokenIdentityName("Иван", "ru-RU")).toBe("Иван");
    expect(spokenIdentityName("Éléonore Müller", "de-CH")).toBe("Éléonore Müller");
    const names = createSpokenIdentities("de-CH", "Иван", "Иван Петров");
    expect(projectSpokenIdentityText("Иван Петров; Иванов; Иван; русский текст", names)).toBe("Ivan Petrov; Иванов; Ivan; русский текст");
    expect(projectSpokenIdentityText("Иван@example.org https://example.org/Иван", names)).toBe("Иван@example.org https://example.org/Иван");
  });
});
