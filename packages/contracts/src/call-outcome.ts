import { z } from "zod";
import {
  callBriefStatusSchema,
  type CallBriefStatus
} from "./call-brief";
import type { DurableCallEvent } from "./call-telemetry";

export const CALL_OUTCOME_SCHEMA_VERSION = 1 as const;

export const semanticCallOutcomeSchema = z.enum([
  "resolved",
  "partially_resolved",
  "unresolved",
  "wrong_recipient",
  "voicemail",
  "declined",
  "technical_failure"
]);
export type SemanticCallOutcome = z.infer<typeof semanticCallOutcomeSchema>;

export const callOutcomeProvenanceSchema = z.enum([
  "system",
  "user",
  "staff"
]);
export type CallOutcomeProvenance = z.infer<
  typeof callOutcomeProvenanceSchema
>;

export const callFailureStageSchema = z.enum([
  "policy",
  "provider",
  "consent",
  "recording",
  "realtime",
  "transcription",
  "recovery"
]);
export type CallFailureStage = z.infer<typeof callFailureStageSchema>;

const safeFailureCodeSchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9_.:/-]+$/i);

export const technicalCallOutcomeSchema = z.strictObject({
  connection: z.enum(["confirmed", "not_confirmed"]),
  terminalStatus: callBriefStatusSchema.nullable(),
  consent: z.enum(["not_recorded", "granted", "failed"]),
  recording: z.enum(["not_recorded", "started", "completed", "failed"]),
  transcription: z.enum([
    "not_recorded",
    "started",
    "completed",
    "failed"
  ]),
  failureStage: callFailureStageSchema.nullable(),
  failureCode: safeFailureCodeSchema.nullable()
});
export type TechnicalCallOutcome = z.infer<
  typeof technicalCallOutcomeSchema
>;

export const callOutcomeRevisionSchema = z.strictObject({
  id: z.uuid(),
  callBriefId: z.uuid(),
  revision: z.number().int().positive(),
  schemaVersion: z.literal(CALL_OUTCOME_SCHEMA_VERSION),
  outcome: semanticCallOutcomeSchema.nullable(),
  provenance: callOutcomeProvenanceSchema,
  actorUserId: z.uuid().nullable(),
  reason: z.enum([
    "technical_state_changed",
    "owner_feedback",
    "staff_review"
  ]),
  technical: technicalCallOutcomeSchema,
  createdAt: z.iso.datetime()
}).superRefine((revision, context) => {
  if (revision.provenance === "system" && revision.actorUserId !== null) {
    context.addIssue({
      code: "custom",
      path: ["actorUserId"],
      message: "System outcome revisions cannot have an actor"
    });
  }
  if (revision.provenance !== "system" && revision.actorUserId === null) {
    context.addIssue({
      code: "custom",
      path: ["actorUserId"],
      message: "User and staff outcome revisions require an actor"
    });
  }
  if (revision.provenance === "system" && revision.outcome !== null) {
    context.addIssue({
      code: "custom",
      path: ["outcome"],
      message: "Technical state cannot infer a semantic outcome"
    });
  }
});
export type CallOutcomeRevision = z.infer<typeof callOutcomeRevisionSchema>;

export const callGoalResultSchema = z.enum(["yes", "partly", "no"]);
export type CallGoalResult = z.infer<typeof callGoalResultSchema>;

export const transcriptQualityRatingSchema = z.enum([
  "good",
  "some_errors",
  "poor"
]);
export type TranscriptQualityRating = z.infer<
  typeof transcriptQualityRatingSchema
>;

const feedbackFieldsSchema = z.strictObject({
  goalResult: callGoalResultSchema,
  transcriptQuality: transcriptQualityRatingSchema.nullable(),
  comment: z.string().trim().max(500).nullable()
});

export const ownerCallFeedbackInputSchema = feedbackFieldsSchema.extend({
  idempotencyKey: z.uuid()
});
export type OwnerCallFeedbackInput = z.infer<
  typeof ownerCallFeedbackInputSchema
>;

export const callFeedbackRevisionSchema = feedbackFieldsSchema.extend({
  id: z.uuid(),
  callBriefId: z.uuid(),
  userId: z.uuid(),
  revision: z.number().int().positive(),
  schemaVersion: z.literal(CALL_OUTCOME_SCHEMA_VERSION),
  createdAt: z.iso.datetime()
});
export type CallFeedbackRevision = z.infer<
  typeof callFeedbackRevisionSchema
>;

export const callOutcomeViewSchema = z.strictObject({
  technical: technicalCallOutcomeSchema,
  latestOutcome: callOutcomeRevisionSchema.nullable(),
  latestFeedback: callFeedbackRevisionSchema.nullable()
});
export type CallOutcomeView = z.infer<typeof callOutcomeViewSchema>;

const countSchema = z.number().int().nonnegative();
export const callOutcomeMetricsSchema = z.strictObject({
  terminalCalls: countSchema,
  feedbackResponses: countSchema,
  goalResults: z.strictObject({
    yes: countSchema,
    partly: countSchema,
    no: countSchema
  }),
  transcriptQuality: z.strictObject({
    good: countSchema,
    someErrors: countSchema,
    poor: countSchema
  }),
  semanticOutcomes: z.strictObject({
    resolved: countSchema,
    partiallyResolved: countSchema,
    unresolved: countSchema,
    wrongRecipient: countSchema,
    voicemail: countSchema,
    declined: countSchema,
    technicalFailure: countSchema
  }),
  technicalFailures: z.strictObject({
    policy: countSchema,
    provider: countSchema,
    consent: countSchema,
    recording: countSchema,
    realtime: countSchema,
    transcription: countSchema,
    recovery: countSchema
  })
});
export type CallOutcomeMetrics = z.infer<typeof callOutcomeMetricsSchema>;

const terminalStatuses = new Set<CallBriefStatus>([
  "blocked",
  "completed",
  "stopped",
  "failed"
]);

export function semanticOutcomeForGoalResult(
  goalResult: CallGoalResult
): SemanticCallOutcome {
  switch (goalResult) {
    case "yes":
      return "resolved";
    case "partly":
      return "partially_resolved";
    case "no":
      return "unresolved";
  }
}

export function deriveTechnicalCallOutcome(
  status: CallBriefStatus,
  events: DurableCallEvent[]
): TechnicalCallOutcome {
  const outcome: TechnicalCallOutcome = {
    connection: "not_confirmed",
    terminalStatus: terminalStatuses.has(status) ? status : null,
    consent: "not_recorded",
    recording: "not_recorded",
    transcription: "not_recorded",
    failureStage: status === "blocked" ? "policy" : null,
    failureCode: status === "blocked" ? "policy_blocked" : null
  };

  for (const event of [...events].sort(
    (left, right) => left.sequence - right.sequence
  )) {
    const payload = event.payload;
    switch (payload.name) {
      case "provider.status_changed":
        if (payload.metadata.callStatus === "failed") {
          setFailure(outcome, "provider", payload.metadata.providerStatus);
        }
        break;
      case "connection.confirmed":
        outcome.connection = "confirmed";
        break;
      case "consent.granted":
        outcome.consent = "granted";
        break;
      case "consent.failed":
        outcome.consent = "failed";
        setFailure(
          outcome,
          payload.metadata.reason === "recording_start_failed"
            ? "recording"
            : "consent",
          payload.metadata.reason
        );
        break;
      case "recording.started":
        outcome.recording = "started";
        break;
      case "recording.completed":
        outcome.recording = "completed";
        break;
      case "recording.failed":
        outcome.recording = "failed";
        setFailure(outcome, "recording", payload.metadata.failureCode);
        break;
      case "conversation.ended":
        if (
          payload.metadata.reason === "openai_error" ||
          payload.metadata.reason === "openai_closed"
        ) {
          setFailure(outcome, "realtime", payload.metadata.reason);
        }
        break;
      case "transcription.started":
        outcome.transcription = "started";
        break;
      case "transcription.completed":
        outcome.transcription = "completed";
        break;
      case "transcription.failed":
        outcome.transcription = "failed";
        setFailure(outcome, "transcription", payload.metadata.failureCode);
        break;
      case "call.recovered":
        setFailure(outcome, "recovery", payload.metadata.reason);
        break;
    }
  }

  if (
    outcome.terminalStatus &&
    outcome.terminalStatus !== "blocked" &&
    outcome.connection === "not_confirmed" &&
    outcome.failureStage === null
  ) {
    setFailure(outcome, "provider", `connection_${outcome.terminalStatus}`);
  }
  return technicalCallOutcomeSchema.parse(outcome);
}

function setFailure(
  outcome: TechnicalCallOutcome,
  stage: CallFailureStage,
  code: string
) {
  outcome.failureStage = stage;
  outcome.failureCode = /^[a-z0-9_.:/-]{1,160}$/i.test(code)
    ? code
    : "unknown_failure";
}
