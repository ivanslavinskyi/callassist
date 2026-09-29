import type { CallSnapshot, FinalTranscriptSegment } from "@callassist/contracts";

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
  const fragments = snapshot.transcript.map((fragment, sequence) => ({ fragment, sequence }))
    .sort((a, b) => (a.fragment.nativeTiming?.startMs ?? 0) - (b.fragment.nativeTiming?.startMs ?? 0) || a.sequence - b.sequence);
  for (const { sequence, fragment } of fragments) {
    const timing = fragment.nativeTiming;
    if (!timing || timing.sessionId !== capture.sessionId || fragment.role === "system" || !fragment.final) continue;
    if (seen.has(timing.eventId)) continue;
    seen.add(timing.eventId);
    const start = Date.parse(timing.sessionStartedAt) + timing.startMs - origin;
    const end = Date.parse(timing.sessionStartedAt) + timing.endMs - origin;
    // Do not invent word-level clipping for a fragment crossing consent/recording.
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) continue;
    const previous = last.get(fragment.role);
    if (previous && start / 1000 >= previous.startSeconds && start / 1000 - previous.endSeconds <= 1.5) {
      previous.text += fragment.text;
      previous.endSeconds = Math.max(previous.endSeconds, end / 1000);
    } else {
      const row = { role: fragment.role, text: fragment.text, startSeconds: start / 1000, endSeconds: end / 1000, sequence };
      rows.push(row); last.set(fragment.role, row);
    }
  }
  const segments = rows.filter(row => row.text.trim()).sort((a, b) => a.startSeconds - b.startSeconds || a.sequence - b.sequence)
    .map(({ role, text, startSeconds, endSeconds }) => ({ role, text, startSeconds, endSeconds }));
  if (!segments.some(row => row.role === "recipient")) return null;
  return { text: segments.map(row => row.text).join("\n"), segments, model: capture.model };
}
