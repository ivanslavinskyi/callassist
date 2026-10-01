import { z } from "zod";

export const transcriptSourceSchema = z.enum(["recording_asr", "live_native", "live_composed"]);
export const transcriptSegmentSourceSchema = z.enum(["live_native", "application_playback", "consent_event"]);
export const transcriptQualityIssueSchema = z.object({
  code: z.enum(["legacy_incomplete", "consent_boundary", "output_boundary", "output_cleared", "application_interrupted", "persistence_failed", "session_unconfirmed"]),
  startMs: z.number().nonnegative().optional(),
  endMs: z.number().nonnegative().optional()
});
export type TranscriptQualityIssue = z.infer<typeof transcriptQualityIssueSchema>;
export const nativeTranscriptCaptureSchema = z.object({
  version: z.literal(1), sessionId: z.string(), model: z.string(),
  status: z.enum(["collecting", "complete", "incomplete"]), updatedAt: z.string().datetime(),
  sessionStartedAt: z.string().datetime().optional(),
  transcriptBoundaryMs: z.number().nonnegative().optional(),
  sessionFinalized: z.boolean().optional(),
  issues: z.array(transcriptQualityIssueSchema).optional()
});
export type NativeTranscriptCapture = z.infer<typeof nativeTranscriptCaptureSchema>;
export const transcriptQualitySchema = z.object({
  coverage: z.enum(["complete", "partial", "unavailable"]),
  sessionFinalized: z.boolean(), issues: z.array(transcriptQualityIssueSchema),
  timeOrigin: z.string().datetime()
});
export const recordingTranscriptRequestSchema = z.object({
  id: z.string().uuid(), requestedAt: z.string().datetime(),
  status: z.enum(["queued", "processing", "completed", "failed", "unavailable"])
});
export const applicationPlaybackReceiptSchema = z.object({
  sessionId: z.string().min(1).max(200),
  markId: z.string().min(1).max(200),
  sentAt: z.string().datetime(),
  acknowledgedAt: z.string().datetime(),
  durationMs: z.number().positive()
}).refine(value => Date.parse(value.acknowledgedAt) >= Date.parse(value.sentAt));

export function isLiveTranscript(source: unknown) {
  return source === "live_native" || source === "live_composed";
}
