import { z } from "zod";

export const TELEMETRY_EXPORT_VERSION = 1 as const;
export const telemetryExportPresetSchema = z.enum(["today", "yesterday", "last7", "last30", "previousMonth", "custom"]);
export const telemetryExportInputSchema = z.strictObject({
  requestId: z.uuid(), preset: telemetryExportPresetSchema,
  timezone: z.literal("Europe/Zurich").default("Europe/Zurich"),
  dateFrom: z.iso.date().optional(), dateTo: z.iso.date().optional(),
  reason: z.string().trim().min(3).max(500)
}).superRefine((value, ctx) => {
  if (value.preset === "custom" && (!value.dateFrom || !value.dateTo || value.dateFrom > value.dateTo)) {
    ctx.addIssue({ code: "custom", message: "Choose a valid date range", path: ["dateTo"] });
  }
  if (value.preset !== "custom" && (value.dateFrom || value.dateTo)) {
    ctx.addIssue({ code: "custom", message: "Dates require the custom preset", path: ["preset"] });
  }
});
export type TelemetryExportInput = z.infer<typeof telemetryExportInputSchema>;
export const telemetryExportStatusSchema = z.enum(["queued", "running", "ready", "failed", "cancelled", "expired", "revoked"]);
export const telemetryExportViewSchema = z.strictObject({
  id: z.uuid(), status: telemetryExportStatusSchema,
  from: z.iso.datetime(), to: z.iso.datetime(), timezone: z.literal("Europe/Zurich"),
  createdAt: z.iso.datetime(), snapshotAt: z.iso.datetime().nullable(), expiresAt: z.iso.datetime().nullable(),
  generation: z.number().int(), records: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(),
  phase: z.string(), failureCode: z.string().nullable(), sha256: z.string().nullable(),
  counts: z.record(z.string(), z.number()), retryable: z.boolean()
});
export type TelemetryExportView = z.infer<typeof telemetryExportViewSchema>;
export const telemetryExportListSchema = z.object({
  available: z.boolean(), items: z.array(telemetryExportViewSchema), nextCursor: z.string().nullable(),
  workerLastSeenAt: z.iso.datetime().nullable().default(null)
});
