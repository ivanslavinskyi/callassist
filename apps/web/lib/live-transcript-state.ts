import { groupNativeTranscriptSegments, transcriptArrivalOrder } from "@callassist/contracts";
export { groupNativeTranscriptSegments } from "@callassist/contracts";
import type { CallEvent, TranscriptSegment } from "@callassist/contracts";

export type LiveTranscriptState = {
  partials: Record<string, { role: "assistant" | "recipient"; text: string; locale: TranscriptSegment["locale"]; nativeTiming?: TranscriptSegment["nativeTiming"] }>;
  finalized: Set<string>;
};
export const emptyLiveTranscript = (): LiveTranscriptState => ({ partials: {}, finalized: new Set() });

export function applyLiveTranscriptEvent(state: LiveTranscriptState, event: CallEvent): LiveTranscriptState {
  if (event.type === "transcript.delta") {
    if (state.finalized.has(event.key)) return state;
    return { ...state, partials: { ...state.partials, [event.key]: {
      role: event.role, locale: event.locale, text: (state.partials[event.key]?.text ?? "") + event.delta, ...(event.nativeTiming ? { nativeTiming: event.nativeTiming } : {})
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
  return [...segments.values()].sort(transcriptArrivalOrder);
}

/** One display timeline for native deltas and persisted evidence. A DB write never
 * replaces a speaker card; event identity also deduplicates snapshot/SSE races. */
export function liveTranscriptRows(segments: TranscriptSegment[], state: LiveTranscriptState): TranscriptSegment[] {
  const nativeKey = (s: TranscriptSegment) => s.nativeTiming ? `${s.nativeTiming.sessionId}:${s.nativeTiming.eventId}` : s.id;
  const all = new Map(segments.map(s => [nativeKey(s), s]));
  for (const [key, partial] of Object.entries(state.partials)) {
    const timing = partial.nativeTiming;
    const segment = { ...partial, id: key, final: false,
      createdAt: timing ? new Date(Date.parse(timing.sessionStartedAt) + timing.startMs).toISOString() : new Date(8640000000000000).toISOString() };
    if (!all.has(nativeKey(segment))) all.set(nativeKey(segment), segment);
  }
  return groupNativeTranscriptSegments([...all.values()]).map(s => ({ ...s, id: nativeKey(s) }));
}
