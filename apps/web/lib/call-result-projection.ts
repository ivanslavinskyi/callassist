import { callSummaryPayloadSchema, transcriptTranslationPayloadSchema, type CallTextArtifact, type FinalTranscriptRevision, type TextLanguage } from "@callassist/contracts";

export function currentResultArtifact(items: CallTextArtifact[], revision: FinalTranscriptRevision, kind: "transcript_translation" | "call_summary", language: TextLanguage) {
  const candidates = items.filter((item) => item.kind === kind && item.transcriptRevisionId === revision.id && item.sourceHash === revision.sourceHash && item.targetLanguage === language)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return candidates.find((item) => kind === "transcript_translation"
    ? translatedTranscript(item, revision) !== null : evidencedSummary(item, revision) !== null) ?? candidates[0];
}

export function translatedTranscript(artifact: CallTextArtifact | undefined, revision: FinalTranscriptRevision) {
  if (!artifact || artifact.kind !== "transcript_translation" || artifact.status !== "ready" || !artifact.payloadHash ||
      artifact.transcriptRevisionId !== revision.id || artifact.sourceHash !== revision.sourceHash) return null;
  const parsed = transcriptTranslationPayloadSchema.safeParse(artifact.payload);
  if (!parsed.success || parsed.data.segments.length !== revision.segments.length) return null;
  for (const [index, segment] of revision.segments.entries()) {
    const translated = parsed.data.segments[index];
    if (!translated || translated.id !== segment.id || translated.role !== segment.role ||
        translated.startSeconds !== segment.startSeconds || translated.endSeconds !== segment.endSeconds) return null;
  }
  return parsed.data;
}

/** Keep the source readable and exportable while an explicitly requested translation is pending or unavailable. */
export function displayedResultTranscript(revision: FinalTranscriptRevision, artifact: CallTextArtifact | undefined, selectedView: "original" | "translated") {
  const translation = translatedTranscript(artifact, revision);
  return selectedView === "translated" && translation
    ? { translation, transcript: translation, view: "translated" as const }
    : { translation, transcript: revision, view: "original" as const };
}

export function evidencedSummary(artifact: CallTextArtifact | undefined, revision: FinalTranscriptRevision) {
  if (!artifact || artifact.kind !== "call_summary" || artifact.status !== "ready" || !artifact.payloadHash ||
      artifact.transcriptRevisionId !== revision.id || artifact.sourceHash !== revision.sourceHash) return null;
  const parsed = callSummaryPayloadSchema.safeParse(artifact.payload);
  if (!parsed.success) return null;
  const ids = new Set(revision.segments.map((segment) => segment.id));
  for (const item of [...parsed.data.answers, ...parsed.data.nextSteps]) {
    if (item.sourceSegmentIds.some((id) => !ids.has(id))) return null;
    if ("certainty" in item && item.certainty !== "unknown" && !item.sourceSegmentIds.length) return null;
  }
  return parsed.data;
}

export function sourceSegmentAnchor(revisionId: string, segmentId: string) {
  return `source-${encodeURIComponent(revisionId)}-${encodeURIComponent(segmentId)}`;
}
