import { describe, expect, it } from "vitest";
import { equivalentIdentityLabel, preservesIdentityLabel } from "./identity-label";

describe("recipient labels, independent of entity type", () => {
  it.each([
    ["Elena", "Елена, здравствуйте.", ""],
    ["Praxis Müller", "Guten Tag, PRAXIS MULLER.", ""],
    ["Café Bellevue", "Merci, Cafe\u0301 Bellevue.", ""],
    ["Центр Олена", "Tsentr Olena, hello.", ""],
    ["Иван Петров", "Вопрос для Ивана Петрова.", "Позвонить от имени Ивана Петрова"],
    ["Elena", "Запись у Елены.", "Запиши к Елене. Спроси у Елены цену."],
    ["Praxis am Bahnhof", "Termin bei Praxis am Bahnhof.", ""],
    ["受付窓口", "受付窓口", ""]
  ])("preserves %s in an attested or mechanically normalized speech form", (original, text, source) => {
    expect(preservesIdentityLabel(original, text, source)).toBe(true);
  });
  it.each([
    ["Nina Keller", "Nena Keller", ""],
    ["Praxis Müller Bern", "Praxis Müller Zürich", ""],
    ["Praxis Müller Bern", "Praxis Müller", ""],
    ["Elena", "Helena", ""],
    ["Ann", "Joanne", ""],
    ["Elena", "Елены", ""],
    ["Центр Олена", "Zentrum Olena", ""]
  ])("rejects substitutions, shortening or guessed translation of %s", (original, text, source) => {
    expect(preservesIdentityLabel(original, text, source)).toBe(false);
  });
  it("does not approve an invented surname or branch in a declared entity", () => {
    expect(equivalentIdentityLabel("Elena", "Elena Smith")).toBe(false);
    expect(equivalentIdentityLabel("Praxis Müller", "Praxis Müller Zürich")).toBe(false);
    expect(equivalentIdentityLabel("Elena", "Елена")).toBe(true);
  });
});
