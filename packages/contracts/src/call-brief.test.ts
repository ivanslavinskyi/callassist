import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURES,
  createCallBriefInputSchema
} from "./call-brief";

const validBrief = {
  recipientName: "Gemeinde Aadorf",
  phoneNumber: "+41523686688",
  objective: "Уточнить, можно ли прислать документы по электронной почте",
  locale: "de-CH" as const,
  allowLanguageSwitch: false,
  allowedFacts: ["Имя владельца", "Место проживания"]
};

describe("createCallBriefInputSchema", () => {
  it("accepts a supported Swiss German call brief", () => {
    const result = createCallBriefInputSchema.safeParse(validBrief);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentName).toBe("Sebastian");
      expect(result.data.speechImpairmentDisclosure).toContain("Sprechbehinderung");
    }
  });

  it("requires a fallback locale when language switching is enabled", () => {
    const result = createCallBriefInputSchema.safeParse({
      ...validBrief,
      allowLanguageSwitch: true
    });

    expect(result.success).toBe(false);
  });

  it("rejects a fallback locale when language switching is disabled", () => {
    const result = createCallBriefInputSchema.safeParse({
      ...validBrief,
      fallbackLocale: "fr-CH"
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unsupported locale", () => {
    const result = createCallBriefInputSchema.safeParse({
      ...validBrief,
      locale: "es-ES"
    });

    expect(result.success).toBe(false);
  });

  it("accepts Russian and provides a localized disclosure", () => {
    const result = createCallBriefInputSchema.safeParse({
      ...validBrief,
      locale: "ru-RU",
      speechImpairmentDisclosure:
        DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURES["ru-RU"]
    });

    expect(result.success).toBe(true);
    expect(DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURES["ru-RU"]).toContain(
      "нарушения речи"
    );
  });
});
