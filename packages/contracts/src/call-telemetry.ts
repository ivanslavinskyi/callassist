import { z } from "zod";
import {
  callBriefStatusSchema,
  callLocaleSchema,
  policyDecisionStatusSchema,
  policyReasonCodeSchema
} from "./call-brief";

export const CALL_TELEMETRY_SCHEMA_VERSION = 1 as const;

const safeTokenSchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9_.:/-]+$/i);
const emptyMetadataSchema = z.strictObject({});
const providerSchema = z.enum(["mock", "twilio"]);

export const callTelemetryPayloadSchema = z.discriminatedUnion("name", [
  z.strictObject({
    name: z.literal("brief.created"),
    metadata: z.strictObject({
      locale: callLocaleSchema,
      compilationRevision: z.number().int().positive(),
      status: callBriefStatusSchema
    })
  }),
  z.strictObject({
    name: z.literal("compilation.completed"),
    metadata: z.strictObject({
      revision: z.number().int().positive(),
      compilerModel: safeTokenSchema,
      compilerVersion: safeTokenSchema,
      policyStatus: policyDecisionStatusSchema
    })
  }),
  z.strictObject({
    name: z.literal("policy.evaluated"),
    metadata: z.strictObject({
      policyVersion: safeTokenSchema,
      status: policyDecisionStatusSchema,
      riskLevel: z.enum(["low", "high"]),
      reasonCodes: z.array(policyReasonCodeSchema).max(6)
    })
  }),
  z.strictObject({
    name: z.literal("compilation.approved"),
    metadata: z.strictObject({ revision: z.number().int().positive() })
  }),
  z.strictObject({
    name: z.literal("attempt.started"),
    metadata: z.strictObject({ provider: providerSchema })
  }),
  z.strictObject({
    name: z.literal("credit.reserved"),
    metadata: z.strictObject({ credits: z.literal(1) })
  }),
  z.strictObject({
    name: z.literal("provider.call_created"),
    metadata: z.strictObject({
      provider: providerSchema,
      providerStatus: safeTokenSchema
    })
  }),
  z.strictObject({
    name: z.literal("provider.status_changed"),
    metadata: z.strictObject({
      providerStatus: safeTokenSchema,
      callStatus: callBriefStatusSchema,
      applied: z.boolean()
    })
  }),
  z.strictObject({
    name: z.literal("connection.confirmed"),
    metadata: z.strictObject({
      providerStatus: z.enum(["in-progress", "completed"])
    })
  }),
  z.strictObject({
    name: z.literal("credit.settled"),
    metadata: z.strictObject({
      settlement: z.enum(["charge", "refund"]),
      connected: z.boolean()
    })
  }),
  z.strictObject({
    name: z.literal("disclosure.started"),
    metadata: emptyMetadataSchema
  }),
  z.strictObject({
    name: z.literal("consent.granted"),
    metadata: z.strictObject({ method: z.literal("dtmf_1") })
  }),
  z.strictObject({
    name: z.literal("consent.failed"),
    metadata: z.strictObject({
      reason: z.enum([
        "timeout",
        "recording_start_failed",
        "stream_ended_before_consent"
      ])
    })
  }),
  z.strictObject({
    name: z.literal("recording.started"),
    metadata: z.strictObject({ providerStatus: safeTokenSchema })
  }),
  z.strictObject({
    name: z.literal("recording.completed"),
    metadata: z.strictObject({
      durationSeconds: z.number().int().nonnegative().nullable(),
      channels: z.number().int().positive().nullable()
    })
  }),
  z.strictObject({
    name: z.literal("recording.failed"),
    metadata: z.strictObject({ failureCode: safeTokenSchema })
  }),
  z.strictObject({
    name: z.literal("realtime.ready"),
    metadata: z.strictObject({
      model: safeTokenSchema,
      transcriptionModel: safeTokenSchema
    })
  }),
  z.strictObject({
    name: z.literal("conversation.started"),
    metadata: emptyMetadataSchema
  }),
  z.strictObject({
    name: z.literal("conversation.first_audio"),
    metadata: z.strictObject({
      latencyMs: z.number().int().nonnegative()
    })
  }),
  z.strictObject({
    name: z.literal("conversation.ended"),
    metadata: z.strictObject({
      reason: z.enum([
        "stream_stopped",
        "socket_closed",
        "no_consent",
        "recording_failure",
        "openai_closed",
        "openai_error"
      ])
    })
  }),
  z.strictObject({
    name: z.literal("transcription.started"),
    metadata: z.strictObject({ model: safeTokenSchema, retry: z.boolean() })
  }),
  z.strictObject({
    name: z.literal("transcription.completed"),
    metadata: z.strictObject({
      model: safeTokenSchema,
      segmentCount: z.number().int().nonnegative()
    })
  }),
  z.strictObject({
    name: z.literal("transcription.failed"),
    metadata: z.strictObject({
      model: safeTokenSchema,
      failureCode: safeTokenSchema
    })
  }),
  z.strictObject({
    name: z.literal("call.recovered"),
    metadata: z.strictObject({ reason: z.literal("server_restarted") })
  })
]);
export type CallTelemetryPayload = z.infer<
  typeof callTelemetryPayloadSchema
>;
export type CallTelemetryEventName = CallTelemetryPayload["name"];

export const callTelemetrySourceSchema = z.enum([
  "api",
  "compiler",
  "policy",
  "credits",
  "telephony",
  "realtime",
  "recording",
  "transcription",
  "system"
]);
export type CallTelemetrySource = z.infer<
  typeof callTelemetrySourceSchema
>;

export const callTelemetryStageSchema = z.enum([
  "brief",
  "compilation",
  "policy",
  "approval",
  "credit",
  "provider",
  "connection",
  "disclosure",
  "consent",
  "recording",
  "realtime",
  "conversation",
  "transcription",
  "recovery"
]);
export type CallTelemetryStage = z.infer<typeof callTelemetryStageSchema>;

export const callTelemetrySeveritySchema = z.enum([
  "info",
  "warning",
  "error"
]);
export type CallTelemetrySeverity = z.infer<
  typeof callTelemetrySeveritySchema
>;

export const callTelemetryEventInputSchema = z.strictObject({
  callAttemptId: z.uuid().nullable().default(null),
  idempotencyKey: safeTokenSchema.max(200),
  occurredAt: z.iso.datetime().optional(),
  payload: callTelemetryPayloadSchema
});
export type CallTelemetryEventInput = z.input<
  typeof callTelemetryEventInputSchema
>;
export type ParsedCallTelemetryEventInput = z.output<
  typeof callTelemetryEventInputSchema
>;

export const durableCallEventSchema = z.strictObject({
  id: z.uuid(),
  callBriefId: z.uuid(),
  callAttemptId: z.uuid().nullable(),
  userId: z.uuid().nullable(),
  sequence: z.number().int().positive(),
  schemaVersion: z.literal(CALL_TELEMETRY_SCHEMA_VERSION),
  source: callTelemetrySourceSchema,
  stage: callTelemetryStageSchema,
  severity: callTelemetrySeveritySchema,
  occurredAt: z.iso.datetime(),
  payload: callTelemetryPayloadSchema
}).superRefine((event, context) => {
  const descriptor = describeCallTelemetryEvent(event.payload.name);
  for (const field of ["source", "stage", "severity"] as const) {
    if (event[field] !== descriptor[field]) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${field} must match the event descriptor`
      });
    }
  }
});
export type DurableCallEvent = z.infer<typeof durableCallEventSchema>;

export function describeCallTelemetryEvent(
  name: CallTelemetryEventName
): {
  source: CallTelemetrySource;
  stage: CallTelemetryStage;
  severity: CallTelemetrySeverity;
} {
  switch (name) {
    case "brief.created":
      return { source: "api", stage: "brief", severity: "info" };
    case "compilation.completed":
      return { source: "compiler", stage: "compilation", severity: "info" };
    case "policy.evaluated":
      return { source: "policy", stage: "policy", severity: "info" };
    case "compilation.approved":
      return { source: "api", stage: "approval", severity: "info" };
    case "attempt.started":
    case "provider.call_created":
    case "provider.status_changed":
      return { source: "telephony", stage: "provider", severity: "info" };
    case "credit.reserved":
    case "credit.settled":
      return { source: "credits", stage: "credit", severity: "info" };
    case "connection.confirmed":
      return { source: "telephony", stage: "connection", severity: "info" };
    case "disclosure.started":
      return { source: "realtime", stage: "disclosure", severity: "info" };
    case "consent.granted":
      return { source: "realtime", stage: "consent", severity: "info" };
    case "consent.failed":
      return { source: "realtime", stage: "consent", severity: "warning" };
    case "recording.started":
    case "recording.completed":
      return { source: "recording", stage: "recording", severity: "info" };
    case "recording.failed":
      return { source: "recording", stage: "recording", severity: "error" };
    case "realtime.ready":
      return { source: "realtime", stage: "realtime", severity: "info" };
    case "conversation.started":
    case "conversation.first_audio":
    case "conversation.ended":
      return { source: "realtime", stage: "conversation", severity: "info" };
    case "transcription.started":
    case "transcription.completed":
      return { source: "transcription", stage: "transcription", severity: "info" };
    case "transcription.failed":
      return { source: "transcription", stage: "transcription", severity: "error" };
    case "call.recovered":
      return { source: "system", stage: "recovery", severity: "warning" };
  }
}
