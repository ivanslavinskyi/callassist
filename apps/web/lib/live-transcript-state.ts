import type { CallEvent, TranscriptSegment } from "@callassist/contracts";

export type LiveTranscriptState = {
  partials: Record<string, { role: "assistant" | "recipient"; text: string; locale: string }>;
  finalized: Set<string>;
};
export const emptyLiveTranscript = (): LiveTranscriptState => ({ partials: {}, finalized: new Set() });

export function applyLiveTranscriptEvent(state: LiveTranscriptState, event: CallEvent): LiveTranscriptState {
  if (event.type === "transcript.delta") {
    if (state.finalized.has(event.key)) return state;
    return { ...state, partials: { ...state.partials, [event.key]: {
      role: event.role, locale: event.locale, text: (state.partials[event.key]?.text ?? "") + event.delta
    } } };
  }
  if ((event.type !== "transcript.added" && event.type !== "transcript.discarded") || !event.key) return state;
  const partials = { ...state.partials };
  delete partials[event.key];
  return { partials, finalized: new Set([...state.finalized, event.key]) };
}

/** Final segments are append-only until the call is deleted. HTTP reads can lag SSE. */
export function mergeTranscriptSegments(current: TranscriptSegment[], incoming: TranscriptSegment[]) {
  const segments = new Map(current.map(segment => [segment.id, segment]));
  for (const segment of incoming) if (!segments.has(segment.id)) segments.set(segment.id, segment);
  return [...segments.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Display grouping only. Native fragments remain independent persisted evidence. */
export function groupNativeTranscriptSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const rows: TranscriptSegment[] = [];
  const lastBySpeaker = new Map<string, TranscriptSegment>();
  for (const segment of [...segments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const timing = segment.nativeTiming;
    if (!timing) { rows.push(segment); lastBySpeaker.clear(); continue; }
    const key = `${timing.sessionId}:${segment.role}:${segment.locale}`;
    const previous = lastBySpeaker.get(key);
    if (previous?.nativeTiming && timing.startMs - previous.nativeTiming.endMs <= 1500) {
      previous.text += segment.text;
      previous.nativeTiming.endMs = Math.max(previous.nativeTiming.endMs, timing.endMs);
    } else {
      const row = { ...segment, nativeTiming: { ...timing } };
      rows.push(row); lastBySpeaker.set(key, row);
    }
  }
  return rows;
}
