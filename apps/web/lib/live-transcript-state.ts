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
