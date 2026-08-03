import { describe, expect, it } from "vitest";
import { createCallBriefInputSchema } from "./call-brief";

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
    expect(createCallBriefInputSchema.safeParse(validBrief).success).toBe(true);
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
      locale: "ru-RU"
    });

    expect(result.success).toBe(false);
  });
});
