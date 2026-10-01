import type { CallBrief, CallTextArtifact, FinalTranscriptRevision } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { appointmentResultState, currentResultArtifact, displayedResultTranscript, evidencedSummary, translatedTranscript } from "./call-result-projection";
import { buildDerivedTranscriptCopyText, buildDerivedTranscriptPdfDefinition } from "./derived-transcript-export";
import { appointmentResultMessages } from "./i18n/appointment-result-messages";

const revision: FinalTranscriptRevision = {
  id: "revision-2", transcriptId: "same-transcript", revision: 2, callAttemptId: null, sourceHash: "a".repeat(64),
  text: "Noch nicht eingegangen.", createdAt: "2026-09-09T12:00:00.000Z",
  segments: [{ id: "segment-1", role: "unknown", text: "Noch nicht eingegangen.", startSeconds: null, endSeconds: null }]
};
const translation = { id: "artifact-1", kind: "transcript_translation", status: "ready", transcriptRevisionId: revision.id,
  sourceHash: revision.sourceHash, targetLanguage: "ru", payloadHash: "b".repeat(64), createdAt: revision.createdAt,
  payload: { text: "Ещё не получено.", segments: [{ ...revision.segments[0], text: "Ещё не получено." }] }
} as CallTextArtifact;

describe("revision-bound call results", () => {
  it("qualifies exported reports with journal state only from the same attempt", () => {
    const boundRevision = { ...revision, callAttemptId: "attempt-2" };
    const action = { callAttemptId: boundRevision.callAttemptId, state: "uncertain" as const, delivery: null };
    const input = { brief: { recipientName: "Office", locale: "de-CH" } as CallBrief,
      revision: boundRevision, segments: revision.segments, text: revision.text, translationLanguage: null, uiLocale: "ru" as const, appointmentAction: action };
    expect(buildDerivedTranscriptCopyText(input)).toContain(appointmentResultMessages.ru.unresolved);
    expect(JSON.stringify(buildDerivedTranscriptPdfDefinition(input))).toContain(appointmentResultMessages.ru.unresolved);
    const foreign = { ...input, appointmentAction: { ...action, callAttemptId: "foreign-attempt" } };
    expect(buildDerivedTranscriptCopyText(foreign)).not.toContain(appointmentResultMessages.ru.unresolved);
    expect(JSON.stringify(buildDerivedTranscriptPdfDefinition(foreign))).not.toContain(appointmentResultMessages.ru.unresolved);
  });
  it("shows journal uncertainty independently of reported text and never borrows another attempt's booking", () => {
    const action = { callAttemptId: "current-attempt", state: "uncertain" as const, delivery: null };
    expect(appointmentResultState(action, revision)).toBeNull();
    expect(appointmentResultState(action, { ...revision, callAttemptId: "older-attempt" })).toBeNull();
    expect(appointmentResultState(action, { ...revision, callAttemptId: action.callAttemptId })).toBe("unresolved");
    expect(appointmentResultState({ ...action, state: "confirmed" }, { ...revision, callAttemptId: action.callAttemptId })).toBe("confirmed");
  });
  it("keeps the original readable and exportable until a requested translation is valid and ready", () => {
    for (const unavailable of [
      undefined,
      { ...translation, status: "queued" as const, payload: null },
      { ...translation, status: "processing" as const, payload: null },
      { ...translation, status: "failed" as const, payload: null },
      { ...translation, status: "stale" as const },
      { ...translation, transcriptRevisionId: "previous-revision" },
      { ...translation, payload: { text: "incomplete", segments: [] } }
    ]) {
      expect(displayedResultTranscript(revision, unavailable, "translated")).toEqual({
        translation: null, transcript: revision, view: "original"
      });
    }
  });
  it("switches to a ready translation only when requested and keeps both views available", () => {
    const ready = translatedTranscript(translation, revision);
    expect(displayedResultTranscript(revision, translation, "translated")).toEqual({ translation: ready, transcript: ready, view: "translated" });
    expect(displayedResultTranscript(revision, translation, "original")).toEqual({ translation: ready, transcript: revision, view: "original" });
  });
  it("does not let an older per-artifact language choice replace the fixed task language", () => {
    const otherLanguage = { ...translation, id: "english-artifact", targetLanguage: "en" as const, createdAt: "2026-09-09T13:00:00Z" };
    expect(currentResultArtifact([translation, otherLanguage], revision, "transcript_translation", "ru")).toBe(translation);
    expect(currentResultArtifact([otherLanguage], revision, "transcript_translation", "ru")).toBeUndefined();
  });
  it("keeps an existing evidenced summary readable after a newer attempt fails", () => {
    const saved: CallTextArtifact = { ...translation, kind: "call_summary",
      payload: { schemaVersion: 2 as const, overview: [], findings: [{ id: "goal", label: "Получение", text: "Нет", certainty: "reported", sourceSegmentIds: ["segment-1"] }], nextSteps: [], unresolved: [] } };
    const failed: CallTextArtifact = { ...saved, id: "new-summary", status: "failed", payload: null, createdAt: "2026-09-09T13:00:00Z" };
    expect(currentResultArtifact([failed, saved], revision, "call_summary", "ru")).toBe(saved);
  });
  it("does not offer cancelled cutover metadata as a result to retry", () => {
    const retired: CallTextArtifact = { ...translation, kind: "call_summary", status: "cancelled", payload: null };
    expect(currentResultArtifact([retired], revision, "call_summary", "ru")).toBeUndefined();
  });
  it("keeps a saved translation readable when a newer generator is pending, failed or invalid", () => {
    for (const candidate of [
      { ...translation, id: "new", status: "queued" as const, payload: null },
      { ...translation, id: "new", status: "failed" as const, payload: null },
      { ...translation, id: "new", payload: { text: "incomplete", segments: [] } }
    ]) {
      const newer = { ...candidate, createdAt: "2026-09-09T13:00:00Z" };
      expect(currentResultArtifact([translation, newer], revision, "transcript_translation", "ru")).toBe(translation);
      expect(currentResultArtifact([translation, newer], { ...revision, sourceHash: "c".repeat(64) }, "transcript_translation", "ru")).toBeUndefined();
    }
  });
  it("does not reuse translation when the same transcript has a new revision", () => {
    expect(translatedTranscript(translation, revision)?.text).toBe("Ещё не получено.");
    const later = { ...revision, id: "revision-3", revision: 3 };
    expect(currentResultArtifact([translation], later, "transcript_translation", "ru")).toBeUndefined();
    expect(translatedTranscript(translation, later)).toBeNull();
  });
  it("rejects incomplete translation or invented roles and timestamps", () => {
    const valid = translatedTranscript(translation, revision)!;
    for (const segments of [[], [{ ...valid.segments[0]!, role: "recipient" as const }], [{ ...valid.segments[0]!, startSeconds: 0 }]]) {
      expect(translatedTranscript({ ...translation, payload: { ...valid, segments } }, revision)).toBeNull();
    }
  });
  it("rejects a claimed answer with no evidence or a foreign evidence reference", () => {
    const summary = { ...translation, kind: "call_summary" as const,
      payload: { schemaVersion: 2 as const, overview: [], findings: [{ id: "goal", label: "Получение", text: "Нет", certainty: "reported" as const, sourceSegmentIds: ["segment-1"] }], nextSteps: [], unresolved: [] }
    };
    expect(evidencedSummary(summary, revision)?.findings[0]?.text).toBe("Нет");
    for (const sourceSegmentIds of [[], ["unknown-source"]]) {
      expect(evidencedSummary({ ...summary, payload: { ...summary.payload, findings: [{ ...summary.payload.findings[0]!, sourceSegmentIds }] } }, revision)).toBeNull();
    }
  });
  it("exports the displayed Unicode translation with its language and source identity without invented time", () => {
    const payload = translatedTranscript(translation, revision)!;
    const input = { brief: { recipientName: "Office", agentName: "Sebastian", locale: "de-CH" } as CallBrief,
      revision, ...payload, translationLanguage: "ru" as const, uiLocale: "de" as const };
    const text = buildDerivedTranscriptCopyText(input);
    expect(text).toContain("Ещё не получено.");
    expect(text).toContain("Übersetzung"); expect(text).toContain("Russisch");
    expect(text).toContain("revision-2"); expect(text).toContain("segment-1");
    expect(text).not.toContain("00:00"); expect(text).not.toContain("Noch nicht eingegangen.");
    const pdf = buildDerivedTranscriptPdfDefinition(input);
    expect(pdf.language).toBe("ru"); expect(pdf.defaultStyle?.font).toBe("Roboto");
    expect(JSON.stringify(pdf.content)).toContain("Ещё не получено.");
  });
});
