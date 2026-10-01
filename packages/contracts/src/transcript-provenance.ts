import { z } from "zod";

export const transcriptSourceSchema = z.enum(["recording_asr", "live_native", "live_composed"]);
export const transcriptSegmentSourceSchema = z.enum(["live_native", "application_playback"]);
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
