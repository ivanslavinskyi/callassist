import { describe, expect, it } from "vitest";
import { buildInitialDisclosure, resolveInitialDisclosure } from "./initial-disclosure";
import { SUPPORTED_CALL_LOCALES, formatPersonName, type ApprovedExecutionSnapshot } from "./call-brief";

describe("initial disclosure", () => {
  const cases = SUPPORTED_CALL_LOCALES.flatMap(locale => (["none", "speech_impairment", "language_barrier"] as const)
    .flatMap(reason => (["female", "male"] as const).map(voice => [locale, reason, voice] as const)));
  it.each(cases)("freezes %s / %s / %s with full name and both recording operations", (locale, reason, voice) => {
    const fullName = formatPersonName(" Nina Maria ", " Keller-Smith ");
    const script = buildInitialDisclosure(locale, fullName, voice, reason);
    expect(script).toMatchObject({ version: "assistance-inline-v1", assistanceReason: reason });
    expect(script.text).toContain("Nina Maria Keller-Smith");
    expect(script.text.match(/\?/g)).toHaveLength(1);
    expect(script.text).toMatch(/ИИ|KI|IA|AI/);
    expect(script.text).toMatch(/расшифровку|transkribieren|transcribe|transcrire|trascrivere/);
    expect(script.text).toMatch(/запись|aufnehmen|record|enregistrer|registrare/);
    if (reason !== "none") expect(script.text).not.toBe(buildInitialDisclosure(locale, fullName, voice, "none").text);
  });
  it("keeps historical approved reason text verbatim without guessing an enum", () => {
    const snapshot = { plan: { callLocale: "ru-RU" }, runtime: { voiceGender: "male", assistanceDisclosure: "Одобренное объяснение." } } as ApprovedExecutionSnapshot;
    expect(resolveInitialDisclosure(snapshot, "Ivan Slavinskyi")).toEqual({ version: "assistance-inline-legacy-v1",
      assistanceReason: null, text: "Здравствуйте, я ИИ-ассистент, звоню от имени Ivan Slavinskyi. Одобренное объяснение. Разрешаете запись и автоматическую расшифровку разговора?" });
  });
  it("uses both edited name fields and preserves a frozen approved script", () => {
    const first = buildInitialDisclosure("en-GB", formatPersonName("Nina", "Keller"), "female", "none");
    const changedFirst = buildInitialDisclosure("en-GB", formatPersonName("Nina Maria", "Keller"), "female", "none");
    const changedLast = buildInitialDisclosure("en-GB", formatPersonName("Nina", "Keller-Smith"), "female", "none");
    expect(changedFirst.text).toContain("Nina Maria Keller"); expect(changedFirst.text).not.toBe(first.text);
    expect(changedLast.text).toContain("Nina Keller-Smith"); expect(changedLast.text).not.toBe(first.text);
    const approved = { plan: { callLocale: "en-GB" }, runtime: { initialDisclosure: first } } as ApprovedExecutionSnapshot;
    expect(resolveInitialDisclosure(approved, "A changed profile name")).toBe(first);
  });
});
