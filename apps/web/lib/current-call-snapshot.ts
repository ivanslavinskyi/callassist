import type { CallSnapshot } from "@callassist/contracts";
import { mergeTranscriptSegments } from "./live-transcript-state";

/** An earlier read must not replace a newer compilation or language-selection receipt. */
export function currentCallSnapshot(current: CallSnapshot | null, incoming: CallSnapshot): CallSnapshot {
  if (!current || current.brief.id !== incoming.brief.id) return incoming;
  if (incoming.brief.updatedAt < current.brief.updatedAt ||
      (incoming.compilation && current.compilation && incoming.compilation.revision < current.compilation.revision)) return current;
  // Deletion removes the compilation as well as the transcript. Never restore it from local state.
  if (current.compilation && !incoming.compilation) return incoming;
  if (current.transcript?.some(segment => !incoming.transcript?.some(next => next.id === segment.id))) {
    incoming = { ...incoming, transcript: mergeTranscriptSegments(current.transcript, incoming.transcript ?? []) };
  }
  if (incoming.compilation?.revision === current.compilation?.revision && current.languageContext &&
      (incoming.languageContext?.selectionRevision ?? 0) < current.languageContext.selectionRevision) {
    return { ...incoming, languageContext: current.languageContext };
  }
  return incoming;
}
