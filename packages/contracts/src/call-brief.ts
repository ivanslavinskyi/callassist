import { z } from "zod";

export const DEFAULT_AGENT_NAME = "Sebastian";
export const DEFAULT_REPRESENTED_PERSON = "Ivan Slavinskyi";
export const DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURE =
  "Herr Slavinskyi ist aufgrund einer Sprechbehinderung beim Telefonieren eingeschränkt und nutzt mich deshalb, um Gespräche in seinem Auftrag zu führen.";

export const SUPPORTED_CALL_LANGUAGES = [
  { locale: "de-CH", label: "Deutsch (Schweiz)", shortLabel: "DE-CH" },
  { locale: "de-DE", label: "Deutsch (Deutschland)", shortLabel: "DE" },
  { locale: "fr-CH", label: "Français (Suisse)", shortLabel: "FR-CH" },
  { locale: "it-CH", label: "Italiano (Svizzera)", shortLabel: "IT-CH" },
  { locale: "en-GB", label: "English (United Kingdom)", shortLabel: "EN-GB" },
  { locale: "en-US", label: "English (United States)", shortLabel: "EN-US" },
  { locale: "ru-RU", label: "Русский", shortLabel: "RU" }
] as const;

export const SUPPORTED_CALL_LOCALES = SUPPORTED_CALL_LANGUAGES.map(
  ({ locale }) => locale
) as [
  (typeof SUPPORTED_CALL_LANGUAGES)[number]["locale"],
  ...(typeof SUPPORTED_CALL_LANGUAGES)[number]["locale"][]
];

export const callLocaleSchema = z.enum(SUPPORTED_CALL_LOCALES);
export type CallLocale = z.infer<typeof callLocaleSchema>;

export const callVoiceGenderSchema = z.enum(["male", "female"]);
export type CallVoiceGender = z.infer<typeof callVoiceGenderSchema>;

export const DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURES: Record<
  CallLocale,
  string
> = {
  "de-CH": DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURE,
  "de-DE": DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURE,
  "fr-CH":
    "Monsieur Slavinskyi éprouve des difficultés à téléphoner en raison d’un trouble de la parole et m’utilise donc pour mener des conversations en son nom.",
  "it-CH":
    "Il signor Slavinskyi ha difficoltà a parlare al telefono a causa di un disturbo del linguaggio e pertanto mi utilizza per condurre conversazioni per suo conto.",
  "en-GB":
    "Mr Slavinskyi has difficulty speaking on the telephone because of a speech impairment, so he uses me to conduct conversations on his behalf.",
  "en-US":
    "Mr. Slavinskyi has difficulty speaking on the telephone because of a speech impairment, so he uses me to conduct conversations on his behalf.",
  "ru-RU":
    "Господин Славинский испытывает затруднения при телефонных разговорах из-за нарушения речи, поэтому использует меня для ведения разговоров от своего имени."
};

export function getDefaultSpeechImpairmentDisclosure(locale: CallLocale) {
  return DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURES[locale];
}

export const callBriefStatusSchema = z.enum([
  "ready",
  "dialing",
  "in_progress",
  "awaiting_approval",
  "completed",
  "stopped",
  "failed"
]);
export type CallBriefStatus = z.infer<typeof callBriefStatusSchema>;

const callBriefInputBaseSchema = z.object({
  recipientName: z.string().trim().min(2, "Укажите адресата"),
  phoneNumber: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, "Используйте международный формат, например +41710000000"),
  objective: z.string().trim().min(10, "Опишите цель звонка подробнее"),
  agentName: z
    .string()
    .trim()
    .min(2, "Укажите имя ассистента")
    .default(DEFAULT_AGENT_NAME),
  representedPerson: z
    .string()
    .trim()
    .min(2, "Укажите, кого представляет ассистент")
    .default(DEFAULT_REPRESENTED_PERSON),
  speechImpairmentDisclosure: z
    .string()
    .trim()
    .min(10, "Опишите причину использования ассистента")
    .default(DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURE),
  context: z.string().trim().default(""),
  locale: callLocaleSchema,
  voiceGender: callVoiceGenderSchema.default("male"),
  allowLanguageSwitch: z.boolean().default(false),
  fallbackLocale: callLocaleSchema.optional(),
  allowedFacts: z.array(z.string().trim().min(1)).default([])
});

function validateLanguagePolicy(
  input: z.infer<typeof callBriefInputBaseSchema>,
  context: z.RefinementCtx
) {
  if (input.allowLanguageSwitch && !input.fallbackLocale) {
    context.addIssue({
      code: "custom",
      message: "Выберите резервный язык",
      path: ["fallbackLocale"]
    });
  }

  if (!input.allowLanguageSwitch && input.fallbackLocale) {
    context.addIssue({
      code: "custom",
      message: "Резервный язык доступен только при разрешённой смене языка",
      path: ["fallbackLocale"]
    });
  }

  if (input.fallbackLocale === input.locale) {
    context.addIssue({
      code: "custom",
      message: "Резервный язык должен отличаться от основного",
      path: ["fallbackLocale"]
    });
  }
}

export const createCallBriefInputSchema = callBriefInputBaseSchema.superRefine(
  validateLanguagePolicy
);

export const callBriefSchema = callBriefInputBaseSchema
  .extend({
    id: z.string().uuid(),
    status: callBriefStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .superRefine(validateLanguagePolicy);

export type CreateCallBriefInput = z.input<typeof createCallBriefInputSchema>;
export type CallBrief = z.infer<typeof callBriefSchema>;

export const transcriptSegmentSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["assistant", "recipient", "system"]),
  text: z.string(),
  locale: callLocaleSchema,
  final: z.boolean(),
  createdAt: z.string().datetime()
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const approvalRequestSchema = z.object({
  id: z.string().uuid(),
  category: z.enum(["contact_email", "postal_address", "date_of_birth", "legal_commitment"]),
  title: z.string(),
  reason: z.string(),
  proposedSpeech: z.string(),
  status: z.enum(["pending", "approved", "declined", "expired"]),
  createdAt: z.string().datetime()
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export const callSnapshotSchema = z.object({
  brief: callBriefSchema,
  transcript: z.array(transcriptSegmentSchema),
  pendingApproval: approvalRequestSchema.nullable()
});
export type CallSnapshot = z.infer<typeof callSnapshotSchema>;

export const approvalDecisionSchema = z.object({
  decision: z.enum(["approved", "declined"])
});
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
