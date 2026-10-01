import { applicationPlaybackReceiptSchema, type CallSnapshot, type FinalTranscriptSegment } from "@callassist/contracts";

/** Capture status is technical provenance, not a speech confidence score. */
export type NativeTranscriptCapture = {
  version: 1;
  sessionId: string;
  model: string;
  status: "collecting" | "complete" | "incomplete";
  updatedAt: string;
};

export function assembleNativeTranscript(snapshot: CallSnapshot, capture: NativeTranscriptCapture) {
  const origin = Date.parse(snapshot.recording?.startedAt ?? "");
  if (capture.status !== "complete" || !Number.isFinite(origin)) return null;
  const seen = new Set<string>();
  const rows: Array<FinalTranscriptSegment & { sequence: number }> = [];
  const last = new Map<string, (typeof rows)[number]>();
  const fragments = snapshot.transcript.flatMap((fragment, sequence) => {
    if (fragment.role === "system" || !fragment.final) return [];
    if (fragment.applicationPlayback) {
      const parsed = applicationPlaybackReceiptSchema.safeParse(fragment.applicationPlayback);
      if (!parsed.success || parsed.data.sessionId !== capture.sessionId || fragment.role !== "assistant") return [];
      const receipt = parsed.data;
      // Twilio's mark is a wall-clock playback receipt, not a word timestamp.
      // Keep its provenance and use the bounded clip interval for ordering.
      const end = Date.parse(receipt.acknowledgedAt) - origin;
      const start = Math.max(Date.parse(receipt.sentAt) - origin, end - receipt.durationMs);
      return [{ fragment, sequence, start, end, key: `playback:${receipt.markId}` }];
    }
    const timing = fragment.nativeTiming;
    if (!timing || timing.sessionId !== capture.sessionId) return [];
    const start = Date.parse(timing.sessionStartedAt) + timing.startMs - origin;
    const end = Date.parse(timing.sessionStartedAt) + timing.endMs - origin;
    return [{ fragment, sequence, start, end, key: `native:${timing.eventId}` }];
  }).sort((a, b) => a.start - b.start || a.sequence - b.sequence);
  for (const { sequence, fragment, start, end, key } of fragments) {
    if (seen.has(key)) continue;
    seen.add(key);
    // Do not invent word-level clipping for a fragment crossing consent/recording.
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) continue;
    if (fragment.role === "system") continue;
    const previous = last.get(fragment.role);
    if (!fragment.applicationPlayback && previous?.source === "live_native" && start / 1000 >= previous.startSeconds && start / 1000 - previous.endSeconds <= 1.5) {
      previous.text += fragment.text;
      previous.endSeconds = Math.max(previous.endSeconds, end / 1000);
    } else {
      const row = { role: fragment.role, text: fragment.text, startSeconds: start / 1000, endSeconds: end / 1000, sequence,
        source: fragment.applicationPlayback ? "application_playback" as const : "live_native" as const,
        ...(fragment.applicationPlayback ? { applicationPlayback: fragment.applicationPlayback } : {}) };
      rows.push(row); last.set(fragment.role, row);
    }
  }
  const segments = rows.filter(row => row.text.trim()).sort((a, b) => a.startSeconds - b.startSeconds || a.sequence - b.sequence)
    .map(({ sequence: _sequence, ...segment }) => segment);
  if (!segments.some(row => row.role === "recipient")) return null;
  const source = segments.some(row => row.source === "application_playback") ? "live_composed" as const : "live_native" as const;
  return { text: segments.map(row => row.text).join("\n"), segments, model: capture.model, source };
}
