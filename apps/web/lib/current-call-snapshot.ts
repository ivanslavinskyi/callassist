import type { CallSnapshot } from "@callassist/contracts";
import { mergeTranscriptSegments } from "./live-transcript-state";

/** An earlier read must not replace a newer compilation or language-selection receipt. */
export function currentCallSnapshot(current: CallSnapshot | null, incoming: CallSnapshot): CallSnapshot {
  if (!current || current.brief.id !== incoming.brief.id) return incoming;
  if (incoming.brief.updatedAt < current.brief.updatedAt ||
      (incoming.compilation && current.compilation && incoming.compilation.revision < current.compilation.revision)) return current;
  // Deletion removes the compilation as well as the transcript. Never restore it from local state.
  if (current.compilation && !incoming.compilation) return incoming;
  // Independent transcript sources can finish without changing the brief timestamp.
  for (const [field, revision] of [["finalTranscript", "finalTranscriptRevision"], ["recordingTranscript", "recordingTranscriptRevision"]] as const) {
    const previous = current[field], next = incoming[field];
    if (previous && (!next || (previous.id === next.id && previous.updatedAt > next.updatedAt))) {
      incoming = { ...incoming, [field]: previous, [revision]: current[revision] };
    }
  }
  if (incoming.brief.updatedAt === current.brief.updatedAt && current.brief.lifecycle?.assessment &&
      (!incoming.brief.lifecycle?.assessment || incoming.brief.lifecycle.assessment.updatedAt < current.brief.lifecycle.assessment.updatedAt)) {
    incoming = { ...incoming, brief: { ...incoming.brief, lifecycle: current.brief.lifecycle } };
  }
  if (incoming.brief.updatedAt === current.brief.updatedAt &&
      (incoming.brief.lifecycle?.eventSequence ?? 0) < (current.brief.lifecycle?.eventSequence ?? 0)) {
    incoming = { ...incoming, brief: { ...incoming.brief, lifecycle: current.brief.lifecycle } };
  }
  if (incoming.brief.updatedAt === current.brief.updatedAt && current.brief.lifecycle &&
      incoming.brief.lifecycle?.eventSequence === current.brief.lifecycle.eventSequence &&
      ["used", "returned"].includes(current.brief.lifecycle.credit) &&
      !["used", "returned"].includes(incoming.brief.lifecycle.credit)) {
    incoming = { ...incoming, brief: { ...incoming.brief, lifecycle: current.brief.lifecycle } };
  }
  if (current.transcript?.some(segment => !incoming.transcript?.some(next => next.id === segment.id))) {
    incoming = { ...incoming, transcript: mergeTranscriptSegments(current.transcript, incoming.transcript ?? []) };
  }
  if (incoming.compilation?.revision === current.compilation?.revision && current.languageContext &&
      (incoming.languageContext?.selectionRevision ?? 0) < current.languageContext.selectionRevision) {
    return { ...incoming, languageContext: current.languageContext };
  }
  return incoming;
}
