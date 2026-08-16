import { z } from "zod";

export const DEFAULT_REPRESENTED_PERSON = "Ivan Slavinskyi";

export const SUPPORTED_CALL_LANGUAGES = [
  { locale: "de-CH", label: "German (Switzerland)", shortLabel: "DE-CH" },
  { locale: "de-DE", label: "German (Germany)", shortLabel: "DE" },
  { locale: "fr-CH", label: "French (Switzerland)", shortLabel: "FR-CH" },
  { locale: "it-CH", label: "Italian (Switzerland)", shortLabel: "IT-CH" },
  { locale: "en-GB", label: "English (United Kingdom)", shortLabel: "EN-GB" },
  { locale: "en-US", label: "English (United States)", shortLabel: "EN-US" },
  { locale: "ru-RU", label: "Russian", shortLabel: "RU" }
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

export const ASSISTANT_PROFILE_IDS = [
  "sebastian",
  "daniel",
  "martin",
  "anna",
  "sofia",
  "maria"
] as const;

export const assistantProfileIdSchema = z.enum(ASSISTANT_PROFILE_IDS);
export type AssistantProfileId = z.infer<typeof assistantProfileIdSchema>;

export type AssistantProfile = {
  id: AssistantProfileId;
  displayName: string;
  voiceGender: CallVoiceGender;
};

export const ASSISTANT_PROFILES = [
  { id: "sebastian", displayName: "Sebastian", voiceGender: "male" },
  { id: "daniel", displayName: "Daniel", voiceGender: "male" },
  { id: "martin", displayName: "Martin", voiceGender: "male" },
  { id: "anna", displayName: "Anna", voiceGender: "female" },
  { id: "sofia", displayName: "Sofia", voiceGender: "female" },
  { id: "maria", displayName: "Maria", voiceGender: "female" }
] as const satisfies readonly AssistantProfile[];

export function getAssistantProfile(id: AssistantProfileId): AssistantProfile {
  return ASSISTANT_PROFILES.find((profile) => profile.id === id)!;
}

export const ASSISTANCE_REASON_IDS = [
  "speech_impairment",
  "language_barrier"
] as const;

export const assistanceReasonSchema = z.enum(ASSISTANCE_REASON_IDS);
export type AssistanceReason = z.infer<typeof assistanceReasonSchema>;

export const audioRetentionDaysSchema = z.union([
  z.literal(0),
  z.literal(7),
  z.literal(30)
]);
export type AudioRetentionDays = z.infer<typeof audioRetentionDaysSchema>;

export const callResultHandlingSchema = z.enum([
  "capture_in_callassist",
  "request_external_delivery",
  "message_only"
]);
export type CallResultHandling = z.infer<typeof callResultHandlingSchema>;

export const callAddressingModeSchema = z.enum([
  "auto",
  "formal",
  "informal"
]);
export type CallAddressingMode = z.infer<typeof callAddressingModeSchema>;

export const callTonePreferenceSchema = z.enum([
  "auto",
  "formal",
  "neutral",
  "friendly"
]);
export type CallTonePreference = z.infer<typeof callTonePreferenceSchema>;

export const voicemailPolicySchema = z.enum([
  "do_not_leave_details",
  "leave_neutral_message"
]);
export type VoicemailPolicy = z.infer<typeof voicemailPolicySchema>;

export const callBlockingIssueCodeSchema = z.enum([
  "missing_required_reference",
  "ambiguous_recipient_or_subject",
  "conflicting_instructions",
  "missing_external_delivery_details",
  "missing_scheduling_constraints",
  "missing_sensitive_disclosure_approval"
]);
export type CallBlockingIssueCode = z.infer<
  typeof callBlockingIssueCodeSchema
>;

export const clarificationAnswerSchema = z.object({
  issueCode: callBlockingIssueCodeSchema,
  answer: z.string().trim().min(1).max(1_000)
});
export type ClarificationAnswer = z.infer<typeof clarificationAnswerSchema>;

type AssistanceDisclosureTemplate = (representedPerson: string) => string;

const ASSISTANCE_DISCLOSURE_TEMPLATES: Record<
  CallLocale,
  Record<AssistanceReason, AssistanceDisclosureTemplate>
> = {
  "de-CH": {
    speech_impairment: (person) =>
      `${person} ist aufgrund einer Sprechbeeinträchtigung beim Telefonieren eingeschränkt und nutzt mich deshalb, um dieses Gespräch in seinem Auftrag zu führen.`,
    language_barrier: (person) =>
      `${person} kann dieses Gespräch aufgrund einer Sprachbarriere nicht selbst auf Deutsch führen und nutzt mich deshalb, um es in seinem Auftrag zu führen.`
  },
  "de-DE": {
    speech_impairment: (person) =>
      `${person} ist aufgrund einer Sprechbeeinträchtigung beim Telefonieren eingeschränkt und nutzt mich deshalb, um dieses Gespräch in seinem Auftrag zu führen.`,
    language_barrier: (person) =>
      `${person} kann dieses Gespräch aufgrund einer Sprachbarriere nicht selbst auf Deutsch führen und nutzt mich deshalb, um es in seinem Auftrag zu führen.`
  },
  "fr-CH": {
    speech_impairment: (person) =>
      `${person} a des difficultés à téléphoner en raison d’un trouble de la parole et m’utilise donc pour mener cet appel en son nom.`,
    language_barrier: (person) =>
      `${person} ne peut pas mener personnellement cet appel en français en raison d’une barrière linguistique et m’utilise donc pour le faire en son nom.`
  },
  "it-CH": {
    speech_impairment: (person) =>
      `${person} ha difficoltà a parlare al telefono a causa di un disturbo del linguaggio e pertanto mi utilizza per condurre questa chiamata per suo conto.`,
    language_barrier: (person) =>
      `${person} non può condurre personalmente questa chiamata in italiano a causa di una barriera linguistica e pertanto mi utilizza per farlo per suo conto.`
  },
  "en-GB": {
    speech_impairment: (person) =>
      `${person} has difficulty speaking on the telephone because of a speech impairment, so they use me to conduct this call on their behalf.`,
    language_barrier: (person) =>
      `${person} cannot conduct this call in English because of a language barrier, so they use me to conduct it on their behalf.`
  },
  "en-US": {
    speech_impairment: (person) =>
      `${person} has difficulty speaking on the telephone because of a speech impairment, so they use me to conduct this call on their behalf.`,
    language_barrier: (person) =>
      `${person} cannot conduct this call in English because of a language barrier, so they use me to conduct it on their behalf.`
  },
  "ru-RU": {
    speech_impairment: (person) =>
      `${person} испытывает затруднения при телефонных разговорах из-за нарушения речи, поэтому использует меня для ведения этого разговора от своего имени.`,
    language_barrier: (person) =>
      `${person} не может самостоятельно провести этот разговор на русском языке из-за языкового барьера, поэтому использует меня для ведения разговора от своего имени.`
  }
};

export function getAssistanceDisclosure(
  locale: CallLocale,
  reason: AssistanceReason,
  representedPerson: string
) {
  return ASSISTANCE_DISCLOSURE_TEMPLATES[locale][reason](representedPerson);
}

export const callBriefStatusSchema = z.enum([
  "review_required",
  "needs_clarification",
  "blocked",
  "ready",
  "dialing",
  "in_progress",
  "awaiting_approval",
  "completed",
  "stopped",
  "failed"
]);
export type CallBriefStatus = z.infer<typeof callBriefStatusSchema>;

const callBriefStoredFieldsSchema = z.object({
  recipientName: z.string().trim().min(2, "Enter a recipient").max(160),
  phoneNumber: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, "Use international format, for example +41710000000"),
  objective: z
    .string()
    .trim()
    .min(10, "Describe the call objective in more detail")
    .max(4_000),
  assistantProfileId: assistantProfileIdSchema,
  representedPerson: z
    .string()
    .trim()
    .min(2, "Enter the person represented by the assistant")
    .max(160)
    .default(DEFAULT_REPRESENTED_PERSON),
  assistanceReason: assistanceReasonSchema,
  context: z.string().trim().max(12_000).default(""),
  locale: callLocaleSchema,
  audioRetentionDays: audioRetentionDaysSchema.default(7),
  allowLanguageSwitch: z.boolean().default(false),
  fallbackLocale: callLocaleSchema.optional(),
  allowedFacts: z
    .array(z.string().trim().min(1).max(300))
    .max(40)
    .default([])
});

const callBriefInputBaseSchema = callBriefStoredFieldsSchema.extend({
  resultHandling: callResultHandlingSchema.default("capture_in_callassist"),
  addressingMode: callAddressingModeSchema.default("formal"),
  tonePreference: callTonePreferenceSchema.default("auto"),
  voicemailPolicy: voicemailPolicySchema.default("do_not_leave_details"),
  deliveryInstruction: z.string().trim().max(1_000).default(""),
  clarificationAnswers: z.array(clarificationAnswerSchema).max(10).default([])
});

function validateLanguagePolicy(
  input: {
    allowLanguageSwitch: boolean;
    fallbackLocale?: CallLocale;
    locale: CallLocale;
  },
  context: z.RefinementCtx
) {
  if (input.allowLanguageSwitch && !input.fallbackLocale) {
    context.addIssue({
      code: "custom",
      message: "Select a fallback language",
      path: ["fallbackLocale"]
    });
  }

  if (!input.allowLanguageSwitch && input.fallbackLocale) {
    context.addIssue({
      code: "custom",
      message: "A fallback language is available only when language switching is enabled",
      path: ["fallbackLocale"]
    });
  }

  if (input.fallbackLocale === input.locale) {
    context.addIssue({
      code: "custom",
      message: "The fallback language must differ from the primary language",
      path: ["fallbackLocale"]
    });
  }
}

export const createCallBriefInputSchema = callBriefInputBaseSchema.superRefine(
  validateLanguagePolicy
);

export type CreateCallBriefInput = z.input<typeof createCallBriefInputSchema>;
export type RawCallBrief = z.output<typeof createCallBriefInputSchema>;

export function normalizeCreateCallBriefInput(input: CreateCallBriefInput) {
  const parsed = createCallBriefInputSchema.parse(input);
  const profile = getAssistantProfile(parsed.assistantProfileId);
  return {
    ...parsed,
    agentName: profile.displayName,
    voiceGender: profile.voiceGender,
    assistanceDisclosure: getAssistanceDisclosure(
      parsed.locale,
      parsed.assistanceReason,
      parsed.representedPerson
    )
  };
}

export type NormalizedCallBriefInput = ReturnType<
  typeof normalizeCreateCallBriefInput
>;

export const CALL_BRIEF_SCHEMA_VERSION = "3" as const;
export const BRIEF_COMPILER_VERSION = "brief-compiler-3" as const;
export const CALL_POLICY_VERSION = "callassist-policy-2" as const;

export const callTaskTypeSchema = z.enum([
  "information_request",
  "receipt_confirmation",
  "appointment_coordination",
  "document_requirements",
  "neutral_message",
  "unsupported"
]);
export type CallTaskType = z.infer<typeof callTaskTypeSchema>;

export const briefRiskCategorySchema = z.enum([
  "harassment_or_abuse",
  "hate_or_discrimination",
  "threat_or_intimidation",
  "manipulation_or_coercion",
  "identity_misrepresentation",
  "high_stakes_legal",
  "high_stakes_financial",
  "high_stakes_medical",
  "political_persuasion",
  "sexual_content",
  "self_harm",
  "bulk_marketing",
  "unrelated_private_data",
  "prompt_injection"
]);
export type BriefRiskCategory = z.infer<typeof briefRiskCategorySchema>;

export const compiledFactSchema = z.object({
  sourceText: z.string().trim().min(1).max(300),
  callLanguageText: z.string().trim().min(1).max(400)
});
export type CompiledFact = z.infer<typeof compiledFactSchema>;

export const compiledQuestionSchema = z.object({
  text: z.string().trim().min(2).max(500),
  purpose: z.string().trim().min(2).max(300),
  required: z.boolean()
});
export type CompiledQuestion = z.infer<typeof compiledQuestionSchema>;

export const compiledFollowUpSchema = z.object({
  condition: z.string().trim().min(2).max(400),
  question: z.string().trim().min(2).max(500)
});
export type CompiledFollowUp = z.infer<typeof compiledFollowUpSchema>;

export const compiledOpeningSchema = z.object({
  recipientAddress: z.string().trim().min(2).max(240),
  purposeStatement: z.string().trim().min(10).max(700),
  readinessQuestion: z.string().trim().min(2).max(300)
});
export type CompiledOpening = z.infer<typeof compiledOpeningSchema>;

export const compiledNamedEntitySchema = z.object({
  type: z.enum([
    "person",
    "organisation",
    "location",
    "date",
    "reference",
    "other"
  ]),
  value: z.string().trim().min(1).max(160)
});
export type CompiledNamedEntity = z.infer<typeof compiledNamedEntitySchema>;

export const callPlanAssumptionCodeSchema = z.enum([
  "spoken_answers_saved_in_callassist",
  "addressing_inferred",
  "tone_inferred",
  "no_detailed_voicemail",
  "neutral_voicemail_only",
  "respect_refusal_and_end"
]);
export type CallPlanAssumptionCode = z.infer<
  typeof callPlanAssumptionCodeSchema
>;

export const callBlockingIssueSchema = z.object({
  code: callBlockingIssueCodeSchema,
  question: z.string().trim().min(2).max(500)
});
export type CallBlockingIssue = z.infer<typeof callBlockingIssueSchema>;

export const compiledCallBriefSchema = z.object({
  schemaVersion: z.literal(CALL_BRIEF_SCHEMA_VERSION),
  callLocale: callLocaleSchema,
  sourceLanguage: z.string().trim().min(2).max(35),
  taskType: callTaskTypeSchema,
  tone: z.enum(["formal", "neutral", "friendly"]),
  addressingStyle: z.enum(["formal", "informal"]),
  resultHandling: callResultHandlingSchema,
  voicemailAction: z.enum(["hang_up", "leave_neutral_message"]),
  refusalBehavior: z.literal("respect_and_end"),
  localizedObjective: z.string().trim().min(10).max(2_000),
  opening: compiledOpeningSchema,
  backgroundSummary: z.string().trim().max(4_000),
  orderedQuestions: z.array(compiledQuestionSchema).min(1).max(12),
  conditionalFollowUps: z.array(compiledFollowUpSchema).max(12),
  successCriteria: z.array(z.string().trim().min(2).max(400)).min(1).max(10),
  unresolvedCriteria: z.array(z.string().trim().min(2).max(400)).min(1).max(10),
  stopConditions: z.array(z.string().trim().min(2).max(400)).min(1).max(10),
  approvedFacts: z.array(compiledFactSchema).max(40),
  prohibitedActions: z.array(z.string().trim().min(2).max(400)).min(1).max(12),
  namedEntities: z.array(compiledNamedEntitySchema).max(40),
  riskCategories: z.array(briefRiskCategorySchema).max(14),
  assumptions: z.array(callPlanAssumptionCodeSchema).max(6),
  blockingIssues: z.array(callBlockingIssueSchema).max(6)
});
export type CompiledCallBrief = z.infer<typeof compiledCallBriefSchema>;

export const policyDecisionStatusSchema = z.enum([
  "ready_for_review",
  "needs_clarification",
  "blocked"
]);
export type PolicyDecisionStatus = z.infer<
  typeof policyDecisionStatusSchema
>;

export const policyReasonCodeSchema = z.enum([
  "input_moderation_flagged",
  "model_refusal",
  "prohibited_content",
  "material_ambiguity",
  "required_information_missing",
  "fact_integrity_failure",
  "plan_constraint_failure",
  "unsupported_task"
]);
export type PolicyReasonCode = z.infer<typeof policyReasonCodeSchema>;

export const policyDecisionSchema = z.object({
  policyVersion: z.literal(CALL_POLICY_VERSION),
  status: policyDecisionStatusSchema,
  riskLevel: z.enum(["low", "high"]),
  reasonCodes: z.array(policyReasonCodeSchema).max(6),
  clarificationQuestions: z.array(z.string().trim().min(2).max(500)).max(10)
});
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;

export const callCompilationSchema = z.object({
  rawBrief: callBriefInputBaseSchema.superRefine(validateLanguagePolicy),
  compiledBrief: compiledCallBriefSchema.nullable(),
  policyDecision: policyDecisionSchema,
  compilerModel: z.string().trim().min(1).max(120),
  compilerVersion: z.literal(BRIEF_COMPILER_VERSION),
  compilerResponseId: z.string().trim().min(1).max(160).nullable(),
  revision: z.number().int().positive(),
  compiledAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/)
});
export type CallCompilation = z.infer<typeof callCompilationSchema>;

export const callBriefSchema = callBriefStoredFieldsSchema
  .extend({
    assistantProfileId: assistantProfileIdSchema.nullable(),
    agentName: z.string().trim().min(2),
    voiceGender: callVoiceGenderSchema,
    assistanceDisclosure: z.string().trim().min(10),
    id: z.string().uuid(),
    status: callBriefStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .superRefine(validateLanguagePolicy);

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

export const callRecordingStatusSchema = z.enum([
  "starting",
  "recording",
  "processing",
  "available",
  "failed",
  "deleted"
]);
export type CallRecordingStatus = z.infer<typeof callRecordingStatusSchema>;

export const callRecordingSchema = z.object({
  id: z.string().uuid(),
  status: callRecordingStatusSchema,
  providerRecordingId: z.string().nullable(),
  consentGrantedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  durationSeconds: z.number().int().nonnegative().nullable(),
  channels: z.number().int().positive().nullable(),
  deleteAfter: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
  failureReason: z.string().nullable()
});
export type CallRecording = z.infer<typeof callRecordingSchema>;

export const finalTranscriptStatusSchema = z.enum([
  "processing",
  "completed",
  "failed"
]);
export type FinalTranscriptStatus = z.infer<
  typeof finalTranscriptStatusSchema
>;

export const finalTranscriptSegmentSchema = z.object({
  role: z.enum(["assistant", "recipient", "unknown"]),
  text: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative()
});
export type FinalTranscriptSegment = z.infer<
  typeof finalTranscriptSegmentSchema
>;

export const finalTranscriptSchema = z.object({
  id: z.string().uuid(),
  status: finalTranscriptStatusSchema,
  text: z.string().nullable(),
  segments: z.array(finalTranscriptSegmentSchema).default([]),
  model: z.string(),
  failureReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable()
});
export type FinalTranscript = z.infer<typeof finalTranscriptSchema>;

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
  compilation: callCompilationSchema.nullable(),
  transcript: z.array(transcriptSegmentSchema),
  pendingApproval: approvalRequestSchema.nullable(),
  recording: callRecordingSchema.nullable(),
  finalTranscript: finalTranscriptSchema.nullable()
});
export type CallSnapshot = z.infer<typeof callSnapshotSchema>;

export const approvalDecisionSchema = z.object({
  decision: z.enum(["approved", "declined"])
});
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
