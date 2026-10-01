import { consentTimeline, groupNativeTranscriptSegments, type CallSnapshot, type FinalTranscript, type FinalTranscriptSegment, type NativeTranscriptCapture } from "@callassist/contracts";
export type { NativeTranscriptCapture } from "@callassist/contracts";

/** Source and coverage are independent. Assembly never requests a model. */
export function assembleNativeTranscript(snapshot: CallSnapshot, capture: NativeTranscriptCapture) {
  if (capture.status === "collecting") return null;
  const firstNative = snapshot.transcript.find(s => s.nativeTiming?.sessionId === capture.sessionId)?.nativeTiming;
  const dates = [capture.sessionStartedAt, firstNative?.sessionStartedAt, snapshot.recording?.startedAt, ...snapshot.transcript.map(s => s.createdAt)]
    .filter((date): date is string => !!date && Number.isFinite(Date.parse(date)));
  const originText = capture.sessionStartedAt ?? firstNative?.sessionStartedAt ?? dates.sort()[0] ?? capture.updatedAt;
  const origin = Date.parse(originText);
  const admitted = snapshot.transcript.filter(fragment => {
    if (!fragment.final || fragment.role === "system") return false;
    if (fragment.applicationPlayback) return fragment.role === "assistant" && fragment.applicationPlayback.sessionId === capture.sessionId;
    if (fragment.nativeTiming) return fragment.nativeTiming.sessionId === capture.sessionId &&
      (capture.transcriptBoundaryMs === undefined || fragment.nativeTiming.startMs >= capture.transcriptBoundaryMs);
    // Older disclosures were persisted only after an uncleared playback mark.
    return fragment.role === "assistant" && !!snapshot.initialDisclosure && fragment.text === snapshot.initialDisclosure.text &&
      (!fragment.callAttemptId || fragment.callAttemptId === snapshot.initialDisclosure.callAttemptId);
  });
  const segments: FinalTranscriptSegment[] = groupNativeTranscriptSegments(admitted).map(fragment => {
    const timing = fragment.nativeTiming, receipt = fragment.applicationPlayback;
    const start = timing ? Date.parse(timing.sessionStartedAt) + timing.startMs : receipt ? Date.parse(receipt.sentAt) : Date.parse(fragment.createdAt);
    const end = timing ? Date.parse(timing.sessionStartedAt) + timing.endMs : receipt ? Date.parse(receipt.acknowledgedAt) : start;
    return { role: fragment.role as "assistant" | "recipient", text: fragment.text,
      startSeconds: Math.max(0, (start-origin)/1000), endSeconds: Math.max(0, (end-origin)/1000),
      source: timing ? "live_native" as const : "application_playback" as const, ...(receipt ? { applicationPlayback: receipt } : {}) };
  }).filter(s => s.text.trim());
  const lifecycle = snapshot.brief.lifecycle;
  if (lifecycle?.consent === "granted" && lifecycle.consentAt) {
    const language = snapshot.brief.locale.split("-")[0] as keyof typeof consentTimeline;
    const copy = consentTimeline[language] ?? consentTimeline.en;
    const at = Math.max(0, (Date.parse(lifecycle.consentAt)-origin)/1000);
    segments.push({ role: "system", source: "consent_event", text: copy.granted + (lifecycle.consentMethod ? " — " + copy[lifecycle.consentMethod] : ""), startSeconds: at, endSeconds: at });
  }
  segments.sort((a,b) => a.startSeconds-b.startSeconds);
  const issues = [...(capture.issues ?? [])];
  if (capture.status === "incomplete" && !issues.length) issues.push({ code: "legacy_incomplete" });
  const coverage = !segments.length ? "unavailable" : capture.status === "incomplete" || issues.length ? "partial" : "complete";
  const source = segments.some(s => s.source === "application_playback") ? "live_composed" as const : "live_native" as const;
  const quality: NonNullable<FinalTranscript["quality"]> = { coverage, issues, sessionFinalized: capture.sessionFinalized ?? capture.status === "complete", timeOrigin: originText };
  return { text: segments.map(s => s.text).join("\n"), segments, model: capture.model, source, quality };
}
export type NativeTranscriptResult = NonNullable<ReturnType<typeof assembleNativeTranscript>>;
