import { describe, expect, it } from "vitest";
import {
  createCallBriefInputSchema,
  getAssistanceDisclosure,
  normalizeCreateCallBriefInput
} from "./call-brief";

const validBrief = {
  recipientName: "Gemeinde Aadorf",
  phoneNumber: "+41523686688",
  objective: "Уточнить, можно ли прислать документы по электронной почте",
  assistantProfileId: "sebastian" as const,
  representedPersonFirstName: "Nina",
  representedPersonLastName: "Keller",
  assistanceReason: "speech_impairment" as const,
  locale: "de-CH" as const,
  allowLanguageSwitch: false,
  allowedFacts: ["Имя владельца", "Место проживания"]
};

describe("createCallBriefInputSchema", () => {
  it("accepts a supported Swiss German call brief", () => {
    const result = createCallBriefInputSchema.safeParse(validBrief);
    expect(result.success).toBe(true);
    if (result.success) {
      const normalized = normalizeCreateCallBriefInput(result.data);
      expect(normalized.agentName).toBe("Sebastian");
      expect(normalized.voiceGender).toBe("male");
      expect(normalized.representedPerson).toBe("Nina Keller");
      expect(result.data.audioRetentionDays).toBe(7);
      expect(result.data).toMatchObject({
        resultHandling: "capture_in_callassist",
        addressingMode: "formal",
        tonePreference: "auto",
        voicemailPolicy: "do_not_leave_details",
        deliveryInstruction: "",
        clarificationAnswers: []
      });
      expect(normalized.assistanceDisclosure).toContain(
        "Sprechbeeinträchtigung"
      );
    }
  });

  it("normalizes Swiss national numbers and rejects foreign destinations", () => {
    const local = createCallBriefInputSchema.parse({
      ...validBrief,
      phoneNumber: "052 368 66 88"
    });
    expect(local.phoneNumber).toBe("+41523686688");

    const foreign = createCallBriefInputSchema.safeParse({
      ...validBrief,
      phoneNumber: "+442079460000"
    });
    expect(foreign.success).toBe(false);
    if (!foreign.success) {
      expect(foreign.error.flatten().fieldErrors.phoneNumber?.[0]).toContain(
        "only call Swiss phone numbers"
      );
    }
  });

  it("requires separate represented-person first and last names", () => {
    const { representedPersonLastName: _omitted, ...withoutLastName } = validBrief;
    expect(createCallBriefInputSchema.safeParse(withoutLastName).success).toBe(false);
    expect(
      createCallBriefInputSchema.safeParse({
        ...validBrief,
        representedPersonFirstName: "",
        representedPersonLastName: "Keller"
      }).success
    ).toBe(false);
  });

  it("accepts only fixed clarification issue codes", () => {
    expect(
      createCallBriefInputSchema.safeParse({
        ...validBrief,
        clarificationAnswers: [
          {
            issueCode: "missing_required_reference",
            answer: "The residence application sent on 12 July"
          }
        ]
      }).success
    ).toBe(true);
    expect(
      createCallBriefInputSchema.safeParse({
        ...validBrief,
        clarificationAnswers: [
          { issueCode: "ask_anything_the_model_wants", answer: "No" }
        ]
      }).success
    ).toBe(false);
  });

  it("derives a female voice from a preset assistant profile", () => {
    const result = createCallBriefInputSchema.safeParse({
      ...validBrief,
      assistantProfileId: "anna"
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(normalizeCreateCallBriefInput(result.data)).toMatchObject({
        agentName: "Anna",
        voiceGender: "female"
      });
    }
  });

  it("rejects unknown assistant profiles", () => {
    expect(
      createCallBriefInputSchema.safeParse({
        ...validBrief,
        assistantProfileId: "offensive-free-form-name"
      }).success
    ).toBe(false);
  });

  it("requires one of the two deterministic assistance reasons", () => {
    const { assistanceReason: _omitted, ...withoutReason } = validBrief;
    expect(createCallBriefInputSchema.safeParse(withoutReason).success).toBe(
      false
    );
    expect(
      createCallBriefInputSchema.safeParse({
        ...validBrief,
        assistanceReason: "custom_reason"
      }).success
    ).toBe(false);
    expect(
      createCallBriefInputSchema.safeParse({
        ...validBrief,
        assistanceReason: "language_barrier"
      }).success
    ).toBe(true);
  });

  it("accepts only the supported audio retention periods", () => {
    expect(
      createCallBriefInputSchema.safeParse({
        ...validBrief,
        audioRetentionDays: 30
      }).success
    ).toBe(true);
    expect(
      createCallBriefInputSchema.safeParse({
        ...validBrief,
        audioRetentionDays: 14
      }).success
    ).toBe(false);
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

  it("generates both Russian disclosure variants from server templates", () => {
    expect(
      getAssistanceDisclosure(
        "ru-RU",
        "speech_impairment",
        "Ivan Slavinskyi"
      )
    ).toContain("нарушения речи");
    expect(
      getAssistanceDisclosure(
        "ru-RU",
        "language_barrier",
        "Ivan Slavinskyi"
      )
    ).toContain("языкового барьера");
  });

  it("localizes the language-barrier disclosure to the call language", () => {
    expect(
      getAssistanceDisclosure(
        "fr-CH",
        "language_barrier",
        "Ivan Slavinskyi"
      )
    ).toContain("barrière linguistique");
    expect(
      getAssistanceDisclosure(
        "it-CH",
        "language_barrier",
        "Ivan Slavinskyi"
      )
    ).toContain("barriera linguistica");
    expect(
      getAssistanceDisclosure(
        "en-GB",
        "language_barrier",
        "Ivan Slavinskyi"
      )
    ).toContain("language barrier");
    expect(
      getAssistanceDisclosure(
        "de-CH",
        "language_barrier",
        "Ivan Slavinskyi"
      )
    ).toContain("Sprachbarriere");
  });

  it("ignores identity and disclosure fields injected by clients", () => {
    const result = createCallBriefInputSchema.safeParse({
      ...validBrief,
      agentName: "Injected name",
      voiceGender: "female",
      assistanceDisclosure: "Injected disclosure text"
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const normalized = normalizeCreateCallBriefInput(result.data);
      expect(normalized).toMatchObject({
        agentName: "Sebastian",
        voiceGender: "male"
      });
      expect(normalized.assistanceDisclosure).not.toContain(
        "Injected disclosure"
      );
    }
  });
});
