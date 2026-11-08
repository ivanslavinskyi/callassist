import { spokenIdentitiesSchema, createSpokenIdentities } from "./spoken-identities";
import { applicationPlaybackReceiptSchema, transcriptSourceSchema, transcriptSegmentSourceSchema, transcriptQualitySchema, nativeTranscriptCaptureSchema, recordingTranscriptRequestSchema } from "./transcript-provenance";
import { answeringApproval, answeringApprovalSchema } from "./call-answering";
import { ASSISTANT_NAME } from "./assistant-identity";
import { buildInitialDisclosure, INITIAL_DISCLOSURE_VERSION } from "./initial-disclosure";
import { buildNativeOpening, nativeOpeningSchema, liveTaskSourcesSchema, liveTaskAppendixSchema } from "./live-task";
import { archivedAppointmentV2Schema, archivedAppointmentV3Schema } from "./archived-appointment";
import { z } from "zod";
import { uiLocales } from "./ui-locales";
import { callLifecycleSchema } from "./call-lifecycle";
import { appointmentAuthorizationSchema } from "./appointment";
import { nativeAppointmentAuthorizationSchema, nativeAppointmentActionSchema } from "./native-appointment";
import {preparationIssueSchema} from "./preparation-issue";
import { swissDestinationPhoneSchema } from "./phone";
import { callLanguageContextSchema } from "./languages";
import { callTextArtifactSchema, finalTranscriptRevisionSchema, planSourceSchema } from "./call-text-artifact";

export const CALL_BRIEF_INPUT_LIMITS = {
  recipientName: 160,
  objective: 4_000,
  representedPersonNamePart: 80,
  representedPerson: 161,
  context: 4_000,
  allowedFact: 300,
  allowedFacts: 40,
  deliveryInstruction: 1_000,
  clarificationAnswer: 1_000,
  clarificationAnswers: 10,
  aggregateTaskTextSoft: 6_000,
  aggregateTaskTextHard: 8_000
} as const;

export function normalizeCallBriefBudgetText(value: string) {
  return value.replace(/\r\n?/g, "\n").normalize("NFC").trim();
}

export function callBriefTaskTextLength(input: {
  objective?: string;
  context?: string;
  allowedFacts?: string[];
  deliveryInstruction?: string;
  clarificationAnswers?: Array<{ answer: string }>;
}) {
  return [
    input.objective ?? "",
    input.context ?? "",
    ...(input.allowedFacts ?? []),
    input.deliveryInstruction ?? "",
    ...(input.clarificationAnswers ?? []).map(({ answer }) => answer)
  ].reduce(
    (total, value) =>
      total + [...normalizeCallBriefBudgetText(value)].length,
    0
  );
}

export const personNamePartSchema = z
  .string()
  .trim()
  .min(1, "Enter a name")
  .max(CALL_BRIEF_INPUT_LIMITS.representedPersonNamePart);

export function formatPersonName(firstName: string, lastName: string) {
  return `${firstName.trim()} ${lastName.trim()}`;
}

export const SUPPORTED_CALL_LANGUAGES = [
  { locale: "de-CH", label: "German", shortLabel: "DE-CH" },
  { locale: "de-DE", label: "German (Germany)", shortLabel: "DE" },
  { locale: "fr-CH", label: "French", shortLabel: "FR-CH" },
  { locale: "it-CH", label: "Italian", shortLabel: "IT-CH" },
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

/** Current choices; persisted schemas intentionally keep historical locales. */
export const SELECTABLE_CALL_LANGUAGES = SUPPORTED_CALL_LANGUAGES.filter(({ locale }) => locale !== "en-US" && locale !== "de-DE");
/** Call availability only; reading historical calls and text languages is unaffected. */
export function isCallLanguageAvailable(locale: CallLocale, role?: string | null): boolean {
  return locale !== "ru-RU" || role === "superadmin";
}

export function selectableCallLanguagesForRole(role?: string | null) {
  return SELECTABLE_CALL_LANGUAGES.filter(({ locale }) => isCallLanguageAvailable(locale, role));
}

export function isSelectableCallLocale(locale: CallLocale, role?: string | null): boolean {
  return SELECTABLE_CALL_LANGUAGES.some(language => language.locale === locale) && isCallLanguageAvailable(locale, role);
}

export const callVoiceGenderSchema = z.enum(["male", "female"]);
export type CallVoiceGender = z.infer<typeof callVoiceGenderSchema>;

/** Versioned product choice, independent of deployment environment and persona names. */
export const LIVE_VOICES = { male: "cedar", female: "marin" } as const;
export const liveVoiceSchema = z.enum(["cedar", "marin"]);

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
  "none",
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
/** Fresh input only. Historical readers retain their original seven-day default. */
export const DEFAULT_AUDIO_RETENTION_DAYS: AudioRetentionDays = 30;

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
  answer: z.string().trim().min(1)
    .max(CALL_BRIEF_INPUT_LIMITS.clarificationAnswer)
});
export type ClarificationAnswer = z.infer<typeof clarificationAnswerSchema>;

type AssistanceDisclosureTemplate = (representedPerson: string) => string;

const ASSISTANCE_DISCLOSURE_TEMPLATES: Record<
  CallLocale,
  Record<AssistanceReason, AssistanceDisclosureTemplate>
> = {
  "de-CH": {
    none: () => "",
    speech_impairment: () =>
      "Für dieses Gespräch werde ich wegen einer Sprechbeeinträchtigung als Assistenz eingesetzt.",
    language_barrier: () =>
      "Für dieses Gespräch werde ich wegen einer Sprachbarriere als Assistenz eingesetzt."
  },
  "de-DE": {
    none: () => "",
    speech_impairment: () =>
      "Für dieses Gespräch werde ich wegen einer Sprechbeeinträchtigung als Assistenz eingesetzt.",
    language_barrier: () =>
      "Für dieses Gespräch werde ich wegen einer Sprachbarriere als Assistenz eingesetzt."
  },
  "fr-CH": {
    none: () => "",
    speech_impairment: () =>
      "Pour cette conversation, j’interviens comme assistant en raison d’un trouble de la parole.",
    language_barrier: () =>
      "Pour cette conversation, j’interviens comme assistant en raison d’une barrière linguistique."
  },
  "it-CH": {
    none: () => "",
    speech_impairment: () =>
      "Per questa conversazione intervengo come assistente a causa di un disturbo del linguaggio.",
    language_barrier: () =>
      "Per questa conversazione intervengo come assistente a causa di una barriera linguistica."
  },
  "en-GB": {
    none: () => "",
    speech_impairment: () =>
      "I am assisting with this conversation because of a speech impairment.",
    language_barrier: () =>
      "I am assisting with this conversation because of a language barrier."
  },
  "en-US": {
    none: () => "",
    speech_impairment: () =>
      "I am assisting with this conversation because of a speech impairment.",
    language_barrier: () =>
      "I am assisting with this conversation because of a language barrier."
  },
  "ru-RU": {
    none: () => "",
    speech_impairment: () =>
      "В этом разговоре я помогаю из-за нарушения речи.",
    language_barrier: () =>
      "В этом разговоре я помогаю из-за языкового барьера."
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
  recipientName: z.string().trim().min(2, "Enter a recipient")
    .max(CALL_BRIEF_INPUT_LIMITS.recipientName),
  phoneNumber: swissDestinationPhoneSchema,
  objective: z
    .string()
    .trim()
    .min(10, "Describe the call objective in more detail")
    .max(CALL_BRIEF_INPUT_LIMITS.objective),
  assistantProfileId: assistantProfileIdSchema,
  representedPerson: z
    .string()
    .trim()
    .min(2, "Enter the person represented by the assistant")
    .max(CALL_BRIEF_INPUT_LIMITS.representedPerson),
  assistanceReason: assistanceReasonSchema.default("none"),
  // Historical storage permits the previous input limit. New submissions are checked below.
  context: z.string().trim().max(12_000).default(""),
  locale: callLocaleSchema,
  audioRetentionDays: audioRetentionDaysSchema.default(7),
  allowLanguageSwitch: z.boolean().default(false),
  fallbackLocale: callLocaleSchema.optional(),
  allowedFacts: z
    .array(z.string().trim().min(1).max(CALL_BRIEF_INPUT_LIMITS.allowedFact))
    .max(CALL_BRIEF_INPUT_LIMITS.allowedFacts)
    .default([])
});

const callBriefInputFieldsSchema = callBriefStoredFieldsSchema
  .omit({ representedPerson: true })
  .extend({
    representedPersonFirstName: personNamePartSchema,
    representedPersonLastName: personNamePartSchema,
    resultHandling: callResultHandlingSchema.default("capture_in_callassist"),
    addressingMode: callAddressingModeSchema.default("formal"),
    tonePreference: callTonePreferenceSchema.default("neutral"),
    voicemailPolicy: voicemailPolicySchema.default("do_not_leave_details"),
    deliveryInstruction: z.string().trim()
      .max(CALL_BRIEF_INPUT_LIMITS.deliveryInstruction).default(""),
    clarificationAnswers: z.array(clarificationAnswerSchema)
      .max(CALL_BRIEF_INPUT_LIMITS.clarificationAnswers).default([])
  });
const withRepresentedPerson = (input: z.output<typeof callBriefInputFieldsSchema>) => ({
    ...input,
    representedPerson: formatPersonName(
      input.representedPersonFirstName,
      input.representedPersonLastName
    )
  });
const callBriefInputBaseSchema = callBriefInputFieldsSchema.transform(withRepresentedPerson);

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

export const createCallBriefInputSchema = callBriefInputFieldsSchema.extend({
  audioRetentionDays: audioRetentionDaysSchema.default(DEFAULT_AUDIO_RETENTION_DAYS)
}).transform(withRepresentedPerson).superRefine(
  (input, context) => {
    validateLanguagePolicy(input, context);
    if (input.context.length > CALL_BRIEF_INPUT_LIMITS.context) context.addIssue({ code: "custom",
      message: `Context must be at most ${CALL_BRIEF_INPUT_LIMITS.context} characters`, path: ["context"] });
    const taskTextLength = callBriefTaskTextLength(input);
    if (taskTextLength > CALL_BRIEF_INPUT_LIMITS.aggregateTaskTextHard) {
      context.addIssue({
        code: "custom",
        message: `Call task text must be at most ${CALL_BRIEF_INPUT_LIMITS.aggregateTaskTextHard} characters in total`,
        path: ["objective"]
      });
    }
  }
);

/** Read/hash already persisted input without applying new creation limits. */
export const storedCallBriefInputSchema = callBriefInputBaseSchema.superRefine(validateLanguagePolicy);

export type CreateCallBriefInput = z.input<typeof createCallBriefInputSchema>;
export type RawCallBrief = z.output<typeof createCallBriefInputSchema>;

/** Apply current product settings to a new/editable brief, never an approved snapshot. */
export function applyCallBriefDefaults<T extends CreateCallBriefInput>(input: T, role = "user"): T {
  const delivery = input.deliveryInstruction?.trim();
  const context = input.context ?? "";
  return { ...input,
    resultHandling: "capture_in_callassist",
    deliveryInstruction: "",
    context: delivery && !context.includes(delivery) ? [context, delivery].filter(Boolean).join("\n\n") : context,
    addressingMode: role === "superadmin" ? input.addressingMode ?? "formal" : "formal",
    tonePreference: role === "superadmin" ? input.tonePreference ?? "neutral" : "neutral"
  };
}

export function normalizeCreateCallBriefInput(input: CreateCallBriefInput) {
  const parsed = createCallBriefInputSchema.parse(input);
  const profile = getAssistantProfile(parsed.assistantProfileId);
  return {
    ...parsed,
    agentName: ASSISTANT_NAME,
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

export const CALL_BRIEF_SCHEMA_VERSION = "8" as const;
export const BRIEF_COMPILER_VERSION = "brief-compiler-10" as const;
export const PREVIOUS_BRIEF_COMPILER_VERSION = "brief-compiler-5" as const;
export const CALL_POLICY_VERSION = "callassist-policy-3" as const;
export const LEGACY_BRIEF_COMPILER_VERSION = "brief-compiler-3" as const;
export function isSupportedBriefCompilerVersion(value: unknown) {
  return value === BRIEF_COMPILER_VERSION || ["brief-compiler-6", "brief-compiler-7", "brief-compiler-8", "brief-compiler-9", "brief-compiler-11", "brief-compiler-12", "brief-compiler-13"].includes(String(value)) || value === PREVIOUS_BRIEF_COMPILER_VERSION || value === "brief-compiler-4" || value === LEGACY_BRIEF_COMPILER_VERSION;
}

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

export const legacyCompiledCallBriefSchema = z.object({
  schemaVersion: z.literal("3"),
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
export const previousCompiledCallBriefSchema = legacyCompiledCallBriefSchema.extend({
  schemaVersion: z.literal("4"),
  appointmentAuthorization: appointmentAuthorizationSchema.nullable()
});
export const currentCompiledCallBriefSchema = previousCompiledCallBriefSchema.extend({
  schemaVersion: z.literal(CALL_BRIEF_SCHEMA_VERSION),
  contextAppendix: liveTaskAppendixSchema.default([])
});
export const nativeActionCompiledCallBriefSchema = currentCompiledCallBriefSchema.extend({
  schemaVersion: z.literal("9"), appointmentAuthorization: z.null(),
  nativeAppointmentAuthorization: nativeAppointmentAuthorizationSchema.nullable()
});
export const archivedMissionBriefSchema = previousCompiledCallBriefSchema.extend({
  schemaVersion: z.literal("5"), taskInstructions: z.string().trim().min(10).max(8_000), orderedQuestions: z.array(compiledQuestionSchema).max(12)
});
export const archivedLimitedBriefSchema = archivedMissionBriefSchema.extend({
  schemaVersion: z.literal("6"), appointmentAuthorization: archivedAppointmentV2Schema.nullable()
});
export const archivedConsistentBriefSchema = archivedLimitedBriefSchema.extend({
  schemaVersion: z.literal("7"), appointmentAuthorization: z.union([archivedAppointmentV3Schema, archivedAppointmentV2Schema]).nullable()
});
export const compiledCallBriefSchema = z.discriminatedUnion("schemaVersion", [legacyCompiledCallBriefSchema, previousCompiledCallBriefSchema, archivedMissionBriefSchema, archivedLimitedBriefSchema, archivedConsistentBriefSchema, currentCompiledCallBriefSchema, nativeActionCompiledCallBriefSchema]);
export type CompiledCallBrief = z.infer<typeof compiledCallBriefSchema>;
export type CurrentCompiledCallBrief = z.infer<typeof currentCompiledCallBriefSchema>;

export const APPROVED_EXECUTION_SNAPSHOT_VERSION = 7 as const;

/**
 * The task-specific contract accepted by Realtime after preparation approval.
 * Audit-only compiler fields (including fact sourceText) and raw form fields are
 * deliberately excluded so they cannot be interpolated into runtime prompts.
 */
export const legacyApprovedExecutionPlanSchema = z.object({
  callLocale: callLocaleSchema,
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
  approvedFacts: z.array(z.string().trim().min(1).max(400)).max(40),
  prohibitedActions: z.array(z.string().trim().min(2).max(400)).min(1).max(12)
}).strict();
export const currentApprovedExecutionPlanSchema = legacyApprovedExecutionPlanSchema.extend({
  appointmentAuthorization: appointmentAuthorizationSchema.nullable()
}).strict();
export const nativeActionExecutionPlanSchema = currentApprovedExecutionPlanSchema.extend({
  appointmentAuthorization: z.null(), nativeAppointmentAuthorization: nativeAppointmentAuthorizationSchema.nullable()
}).strict();
export const archivedMissionPlanSchema = currentApprovedExecutionPlanSchema.extend({
  taskInstructions: z.string().trim().min(10).max(8_000), orderedQuestions: z.array(compiledQuestionSchema).max(12)
});
export const archivedLimitedPlanSchema = archivedMissionPlanSchema.extend({ appointmentAuthorization: archivedAppointmentV2Schema.nullable() });
export const archivedConsistentPlanSchema = archivedLimitedPlanSchema.extend({ appointmentAuthorization: z.union([archivedAppointmentV3Schema, archivedAppointmentV2Schema]).nullable() });
export const approvedExecutionPlanSchema = z.union([nativeActionExecutionPlanSchema, archivedConsistentPlanSchema, archivedLimitedPlanSchema, archivedMissionPlanSchema, currentApprovedExecutionPlanSchema, legacyApprovedExecutionPlanSchema]);
export type ApprovedExecutionPlan = z.infer<
  typeof approvedExecutionPlanSchema
>;

export const approvedExecutionRuntimeSchema = z.object({
  spokenIdentities: spokenIdentitiesSchema.optional(),
  agentName: z.string().trim().min(2),
  voiceGender: callVoiceGenderSchema,
  // Optional only for historical immutable approvals.
  liveVoice: liveVoiceSchema.optional(),
  assistanceDisclosure: z.string().trim(),
  initialDisclosure: z.strictObject({ version: z.literal(INITIAL_DISCLOSURE_VERSION),
    text: z.string().trim().min(10).max(2_000), assistanceReason: assistanceReasonSchema }).optional(),
  audioRetentionDays: audioRetentionDaysSchema,
  allowLanguageSwitch: z.boolean(),
  fallbackLocale: callLocaleSchema.optional()
}).strict().refine(runtime => !runtime.liveVoice || runtime.liveVoice === LIVE_VOICES[runtime.voiceGender], {
  message: "Live voice must match the approved voice gender", path: ["liveVoice"]
});
export type ApprovedExecutionRuntime = z.infer<
  typeof approvedExecutionRuntimeSchema
>;

export const legacyApprovedExecutionSnapshotSchema = z.object({
  version: z.literal(1),
  callBriefId: z.string().uuid(),
  compilationRevision: z.number().int().positive(),
  compilationSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  approvedAt: z.string().datetime(),
  plan: legacyApprovedExecutionPlanSchema,
  runtime: approvedExecutionRuntimeSchema
}).strict();
export const previousApprovedExecutionSnapshotSchema = legacyApprovedExecutionSnapshotSchema.extend({
  version: z.literal(2), plan: currentApprovedExecutionPlanSchema
}).strict();
export const answeringApprovedExecutionSnapshotSchema = previousApprovedExecutionSnapshotSchema.extend({
  version: z.literal(3),
  answering: answeringApprovalSchema
}).strict();
export const currentApprovedExecutionSnapshotSchema = answeringApprovedExecutionSnapshotSchema.extend({
  version: z.literal(APPROVED_EXECUTION_SNAPSHOT_VERSION),
  taskSources: liveTaskSourcesSchema,
  contextAppendix: liveTaskAppendixSchema,
  nativeOpening: nativeOpeningSchema
}).strict();
export const nativeActionExecutionSnapshotSchema = currentApprovedExecutionSnapshotSchema.extend({
  version: z.literal(8), plan: nativeActionExecutionPlanSchema
}).strict();
export const archivedMissionSnapshotSchema = answeringApprovedExecutionSnapshotSchema.extend({ version: z.literal(4), plan: archivedMissionPlanSchema });
export const archivedLimitedSnapshotSchema = answeringApprovedExecutionSnapshotSchema.extend({ version: z.literal(5), plan: archivedLimitedPlanSchema });
export const archivedConsistentSnapshotSchema = answeringApprovedExecutionSnapshotSchema.extend({ version: z.literal(6), plan: archivedConsistentPlanSchema });
export const approvedExecutionSnapshotSchema = z.discriminatedUnion("version", [
  legacyApprovedExecutionSnapshotSchema, previousApprovedExecutionSnapshotSchema, answeringApprovedExecutionSnapshotSchema,
  archivedMissionSnapshotSchema, archivedLimitedSnapshotSchema, archivedConsistentSnapshotSchema, currentApprovedExecutionSnapshotSchema, nativeActionExecutionSnapshotSchema
]).superRefine((snapshot, context) => {
  if ("answering" in snapshot) {
    const expected = answeringApproval(snapshot.plan.voicemailAction, snapshot.plan.callLocale, snapshot.answering.policyVersion);
    if (JSON.stringify(expected) !== JSON.stringify(snapshot.answering)) context.addIssue({
      code: "custom", message: "Answering policy does not match the approved plan", path: ["answering"]
    });
  }
  const { allowLanguageSwitch, fallbackLocale } = snapshot.runtime;
  if (allowLanguageSwitch && !fallbackLocale) {
    context.addIssue({
      code: "custom",
      message: "Select a fallback language",
      path: ["runtime", "fallbackLocale"]
    });
  }
  if (!allowLanguageSwitch && fallbackLocale) {
    context.addIssue({
      code: "custom",
      message: "A fallback language is available only when language switching is enabled",
      path: ["runtime", "fallbackLocale"]
    });
  }
  if (fallbackLocale === snapshot.plan.callLocale) {
    context.addIssue({
      code: "custom",
      message: "The fallback language must differ from the primary language",
      path: ["runtime", "fallbackLocale"]
    });
  }
});
export type ApprovedExecutionSnapshot = z.infer<
  typeof approvedExecutionSnapshotSchema
>;

export function createApprovedExecutionPlan(
  compiled: CompiledCallBrief
): ApprovedExecutionPlan {
  return approvedExecutionPlanSchema.parse({
    callLocale: compiled.callLocale,
    taskType: compiled.taskType,
    tone: compiled.tone,
    addressingStyle: compiled.addressingStyle,
    resultHandling: compiled.resultHandling,
    voicemailAction: compiled.voicemailAction,
    refusalBehavior: compiled.refusalBehavior,
    localizedObjective: compiled.localizedObjective,
    opening: compiled.opening,
    backgroundSummary: compiled.backgroundSummary,
    orderedQuestions: compiled.orderedQuestions,
    conditionalFollowUps: compiled.conditionalFollowUps,
    successCriteria: compiled.successCriteria,
    unresolvedCriteria: compiled.unresolvedCriteria,
    stopConditions: compiled.stopConditions,
    approvedFacts: compiled.approvedFacts.map(
      ({ callLanguageText }) => callLanguageText
    ),
    prohibitedActions: compiled.prohibitedActions,
    ...(compiled.schemaVersion === "9" ? {nativeAppointmentAuthorization:compiled.nativeAppointmentAuthorization} : {}),
    ...("appointmentAuthorization" in compiled ? { appointmentAuthorization: compiled.appointmentAuthorization } : {}),
    ...("taskInstructions" in compiled ? { taskInstructions: compiled.taskInstructions } : {})
  });
}

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

export const legacyPolicyDecisionSchema = z.object({
  policyVersion: z.literal("callassist-policy-2"),
  status: policyDecisionStatusSchema,
  riskLevel: z.enum(["low", "high"]),
  reasonCodes: z.array(policyReasonCodeSchema).max(6),
  clarificationQuestions: z.array(z.string().trim().min(2).max(500)).max(10)
});
export const currentPolicyDecisionSchema = legacyPolicyDecisionSchema.extend({ policyVersion: z.literal(CALL_POLICY_VERSION), issue:preparationIssueSchema.optional() });
export const policyDecisionSchema = z.discriminatedUnion("policyVersion", [legacyPolicyDecisionSchema, currentPolicyDecisionSchema]);
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;

export const callCompilationSchema = z.object({
  displayObjective: z.object({ text: z.string().trim().min(1).max(2000), language: z.string().min(2).max(35) }).optional(),
  rawBrief: callBriefInputBaseSchema.superRefine(validateLanguagePolicy),
  compiledBrief: compiledCallBriefSchema.nullable(),
  policyDecision: policyDecisionSchema,
  compilerModel: z.string().trim().min(1).max(120),
  compilerVersion: z.enum([LEGACY_BRIEF_COMPILER_VERSION, "brief-compiler-4", PREVIOUS_BRIEF_COMPILER_VERSION, "brief-compiler-6", "brief-compiler-7", "brief-compiler-8", "brief-compiler-9", BRIEF_COMPILER_VERSION, "brief-compiler-11", "brief-compiler-12", "brief-compiler-13"]),
  compilerResponseId: z.string().trim().min(1).max(160).nullable(),
  revision: z.number().int().positive(),
  compiledAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/)
}).superRefine((compilation, context) => {
  const legacy = compilation.compilerVersion === LEGACY_BRIEF_COMPILER_VERSION;
  const expectedSchema = legacy ? "3" : ["brief-compiler-11", "brief-compiler-12", "brief-compiler-13"].includes(compilation.compilerVersion) ? "9" : compilation.compilerVersion === BRIEF_COMPILER_VERSION ? "8"
    : compilation.compilerVersion === "brief-compiler-9" ? "7" : compilation.compilerVersion === "brief-compiler-8" ? "6"
    : compilation.compilerVersion === "brief-compiler-7" ? "5" : "4";
  if ((compilation.compiledBrief && compilation.compiledBrief.schemaVersion !== expectedSchema) ||
    compilation.policyDecision.policyVersion !== (legacy ? "callassist-policy-2" : CALL_POLICY_VERSION)) {
    context.addIssue({ code: "custom", message: "Compilation versions must belong to the same supported format" });
  }
});
export type CallCompilation = z.infer<typeof callCompilationSchema>;

export const compilationApprovalInputSchema = z.strictObject({
  revision: z.number().int().positive(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/)
});
export type CompilationApprovalInput = z.infer<
  typeof compilationApprovalInputSchema
>;

export function compilationApprovalInput(
  compilation: Pick<CallCompilation, "revision" | "snapshotHash">
): CompilationApprovalInput {
  return {
    revision: compilation.revision,
    snapshotHash: compilation.snapshotHash
  };
}

export const callBriefSchema = callBriefStoredFieldsSchema
  .extend({
    assistantProfileId: assistantProfileIdSchema.nullable(),
    spokenIdentities: spokenIdentitiesSchema.optional(),
  agentName: z.string().trim().min(2),
    representedPersonFirstName: personNamePartSchema,
    representedPersonLastName: personNamePartSchema,
    voiceGender: callVoiceGenderSchema,
    assistanceDisclosure: z.string().trim(),
    id: z.string().uuid(),
    status: callBriefStatusSchema,
    lifecycle: callLifecycleSchema.optional(),
    retrySourceCallId: z.string().uuid().nullable().optional(),
    creationUiLocale: z.enum(uiLocales).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .superRefine(validateLanguagePolicy);

export type CallBrief = z.infer<typeof callBriefSchema>;

export const transcriptSegmentSchema = z.object({
  ingestionSequence: z.number().int().nonnegative().optional(),
  receivedAt: z.string().datetime().optional(),
  callAttemptId: z.string().uuid().nullable().optional(),
  id: z.string().uuid(),
  role: z.enum(["assistant", "recipient", "system"]),
  text: z.string(),
  locale: callLocaleSchema,
  final: z.boolean(),
  createdAt: z.string().datetime(),
  applicationPlayback: applicationPlaybackReceiptSchema.optional(),
  nativeTiming: z.object({
    sessionId: z.string().min(1).max(200), eventId: z.string().min(1).max(200),
    sessionStartedAt: z.string().datetime(), startMs: z.number().nonnegative(), endMs: z.number().nonnegative()
  }).refine(value => value.endMs >= value.startMs).optional()
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
  consentGrantedAt: z.string().datetime().nullable(),
  recordingBasis: z.enum(["affirmative_consent", "declarative_local"]).optional(),
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
  source: transcriptSegmentSourceSchema.optional(),
  applicationPlayback: applicationPlaybackReceiptSchema.optional(),
  role: z.enum(["assistant", "recipient", "unknown", "system"]),
  text: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative()
});
export type FinalTranscriptSegment = z.infer<
  typeof finalTranscriptSegmentSchema
>;

export const finalTranscriptSchema = z.object({
  quality: transcriptQualitySchema.optional(),
  source: transcriptSourceSchema.optional(),
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
  nativeAppointmentAction: nativeAppointmentActionSchema.nullable().optional(),
  nativeTranscriptCapture: nativeTranscriptCaptureSchema.nullable().optional(),
  recordingTranscript: finalTranscriptSchema.nullable().optional(),
  recordingTranscriptRevision: finalTranscriptRevisionSchema.nullable().optional(),
  recordingTranscriptRequest: recordingTranscriptRequestSchema.nullable().optional(),
  initialDisclosure: z.strictObject({ callAttemptId: z.uuid(), version: z.literal(INITIAL_DISCLOSURE_VERSION),
    locale: callLocaleSchema, text: z.string().min(10).max(2_000) }).nullable().optional(),
  appointmentAction: z.strictObject({ callAttemptId: z.uuid(), state: z.enum(["sending", "delivered", "uncertain", "confirmed"]),
    delivery: z.strictObject({ kind: z.enum(["request", "status_check"]), status: z.enum(["not_sent", "unacknowledged", "played"]),
      attempt: z.number().int().min(1).max(3) }).nullable() }).nullable().optional(),
  finalTranscriptRevision: finalTranscriptRevisionSchema.nullable().optional(),
  textArtifacts: z.array(callTextArtifactSchema).optional(),
  languageContext: callLanguageContextSchema.nullable().optional(),
  planSource: planSourceSchema.nullable().optional(),
  executionPlanSource: z.enum([
    "immutable",
    "legacy",
    "archived",
    "recompile_required",
    "unavailable"
  ]),
  // Read-only snapshots can contain objectives saved before the current input limit.
  brief: callBriefSchema.safeExtend({ objective: z.string().trim().min(10) }),
  compilation: callCompilationSchema.nullable(),
  transcript: z.array(transcriptSegmentSchema),
  pendingApproval: approvalRequestSchema.nullable(),
  recording: callRecordingSchema.nullable(),
  finalTranscript: finalTranscriptSchema.nullable()
});
export type CallSnapshot = z.infer<typeof callSnapshotSchema>;

export function createApprovedExecutionSnapshot(
  snapshot: Pick<CallSnapshot, "brief" | "compilation">
): ApprovedExecutionSnapshot {
  const compilation = snapshot.compilation;
  const compiled = compilation?.compiledBrief;
  if (
    !compilation ||
    !compiled ||
    !compilation.approvedAt ||
    compilation.policyDecision.status !== "ready_for_review" ||
    compiled.blockingIssues.length > 0
  ) {
    throw new Error("CALL_EXECUTION_SNAPSHOT_NOT_APPROVED");
  }

  const spokenIdentities = createSpokenIdentities(compiled.callLocale, compilation.rawBrief.recipientName, compilation.rawBrief.representedPerson);
  return approvedExecutionSnapshotSchema.parse({
    version: compiled.schemaVersion === "9" ? 8 : compiled.schemaVersion === "8" ? APPROVED_EXECUTION_SNAPSHOT_VERSION
      : compiled.schemaVersion === "7" ? 6 : compiled.schemaVersion === "6" ? 5 : compiled.schemaVersion === "5" ? 4 : 3,
    callBriefId: snapshot.brief.id,
    compilationRevision: compilation.revision,
    compilationSnapshotHash: compilation.snapshotHash,
    approvedAt: compilation.approvedAt,
    plan: { appointmentAuthorization: null, ...createApprovedExecutionPlan(compiled) },
    answering: answeringApproval(compiled.voicemailAction, compiled.callLocale),
    ...("contextAppendix" in compiled ? {
      taskSources: liveTaskSourcesSchema.parse({ objective: compilation.rawBrief.objective, context: compilation.rawBrief.context,
        allowedFacts: compilation.rawBrief.allowedFacts, clarificationAnswers: compilation.rawBrief.clarificationAnswers,
        deliveryInstruction: compilation.rawBrief.deliveryInstruction }),
      contextAppendix: compiled.contextAppendix,
      nativeOpening: buildNativeOpening({ locale: compiled.callLocale, representedPerson: spokenIdentities.representedPerson.spoken,
        assistantName: ASSISTANT_NAME, voiceGender: snapshot.brief.voiceGender, addressingStyle: compiled.addressingStyle,
        assistanceReason: compilation.rawBrief.assistanceReason, purposeExample: compiled.opening.purposeStatement })
    } : {}),
    runtime: {
      spokenIdentities,
      agentName: ASSISTANT_NAME,
      voiceGender: snapshot.brief.voiceGender,
      liveVoice: LIVE_VOICES[snapshot.brief.voiceGender],
      assistanceDisclosure: snapshot.brief.assistanceDisclosure,
      initialDisclosure: buildInitialDisclosure(compiled.callLocale,
        spokenIdentities.representedPerson.spoken,
        snapshot.brief.voiceGender, snapshot.brief.assistanceReason),
      audioRetentionDays: snapshot.brief.audioRetentionDays,
      allowLanguageSwitch: snapshot.brief.allowLanguageSwitch,
      fallbackLocale: snapshot.brief.fallbackLocale
    }
  });
}

export const approvalDecisionSchema = z.object({
  decision: z.enum(["approved", "declined"])
});
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
