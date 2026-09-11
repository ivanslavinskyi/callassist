"use client";

import { type CallBrief, type CallTextArtifact, type FinalTranscriptRevision, type SourceSegment, type TextLanguage } from "@callassist/contracts";
import { useEffect, useState } from "react";
import { ApiError, requestCallSummary, requestTranscriptTranslation, retryCallTextArtifact } from "@/lib/api";
import { currentResultArtifact, displayedResultTranscript, evidencedSummary, sourceSegmentAnchor } from "@/lib/call-result-projection";
import { buildDerivedTranscriptCopyText, buildDerivedTranscriptPdfDefinition, derivedTranscriptFilename, type DerivedTranscriptExport } from "@/lib/derived-transcript-export";
import { formatTranscriptOffset, writeTextToClipboard } from "@/lib/final-transcript-export";
import { getTextLanguageLabel } from "@/lib/i18n/language-messages";
import { textArtifactMessages } from "@/lib/i18n/text-artifact-messages";
import { CallSummaryPresentation } from "./call-summary-presentation";
import { useCallTextArtifacts } from "./use-call-text-artifacts";
import { useUiLocale } from "./ui-locale-provider";
import { useCallDraftStore } from "./call-draft-provider";
import { canGenerateText, useTextCapabilities } from "./use-text-capabilities";
import { canRequestTextArtifact } from "@/lib/text-artifact-retry";

export function CallResultPanel({ brief, userId, revision, taskLanguage, initialArtifacts }: {
  brief: CallBrief; userId: string; revision: FinalTranscriptRevision; taskLanguage: TextLanguage;
  initialArtifacts?: CallTextArtifact[];
}) {
  const { locale, messages } = useUiLocale();
  const copy = textArtifactMessages[locale];
  const { capabilities, availabilityStatus, refreshCapabilities } = useTextCapabilities();
  const store = useCallDraftStore();
  const viewKey = `result:${brief.id}:${revision.id}:${taskLanguage}`;
  const [view, setView] = useState<"original" | "translated">(() => store.getView(userId, viewKey) === "translated" ? "translated" : "original");
  const [busy, setBusy] = useState<"translation" | "summary" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<"idle" | "copied" | "exporting" | "failed">("idle");
  const { items, remember, refresh, pollingPaused } = useCallTextArtifacts(brief.id, initialArtifacts);
  const translationArtifact = currentResultArtifact(items, revision, "transcript_translation", taskLanguage);
  const summaryArtifact = currentResultArtifact(items, revision, "call_summary", taskLanguage);
  const summary = evidencedSummary(summaryArtifact, revision);
  const { translation, transcript: displayed, view: displayedView } = displayedResultTranscript(revision, translationArtifact, view);
  const waitingTranslation = busy === "translation" || translationArtifact?.status === "queued" || translationArtifact?.status === "processing";
  const waitingSummary = busy === "summary" || summaryArtifact?.status === "queued" || summaryArtifact?.status === "processing";
  // A transcript may contain several spoken languages, regardless of the selected voice locale.
  const canTranslate = availabilityStatus === "ready" && canGenerateText(capabilities, "transcript_translation", "*", taskLanguage);
  const canSummarize = availabilityStatus === "ready" && canGenerateText(capabilities, "call_summary", "*", taskLanguage);
  const availabilityMessage = availabilityStatus === "loading" ? copy.checkingAvailability
    : availabilityStatus === "error" ? copy.availabilityError
    : capabilities?.textGenerationEnabled === false ? copy.generationDisabled : null;
  const translationStatusMessage = waitingTranslation ? (pollingPaused ? copy.pending : copy.loading)
    : translationArtifact?.status === "stale" ? copy.stale
    : translationArtifact ? (translationArtifact.status === "failed" && !translationArtifact.retryable ? copy.retryUnavailable : copy.translationUnavailable)
    : availabilityMessage ?? (!canTranslate ? copy.unsupported : null);

  useEffect(() => { setExportStatus("idle"); }, [displayedView, taskLanguage, revision.id]);
  function chooseView(next: "original" | "translated") { store.setView(userId, viewKey, next); setView(next); }
  async function generate(kind: "translation" | "summary", retry = false) {
    setBusy(kind); setError(null);
    const artifact = kind === "translation" ? translationArtifact : summaryArtifact;
    try {
      remember(retry && artifact ? await retryCallTextArtifact(brief.id, artifact.id)
        : kind === "translation" ? await requestTranscriptTranslation(brief.id, { sourceRevisionId: revision.id, targetLanguage: taskLanguage })
          : await requestCallSummary(brief.id, { sourceRevisionId: revision.id, targetLanguage: taskLanguage }));
      if (kind === "translation") chooseView("translated");
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 422 ? copy.unsupported
        : caught instanceof ApiError && caught.status === 429 ? copy.rateLimited : copy.generationError);
    } finally { setBusy(null); }
  }
  function revealSource(segmentId: string) {
    chooseView("original");
    window.requestAnimationFrame(() => {
      const target = document.getElementById(sourceSegmentAnchor(revision.id, segmentId));
      target?.scrollIntoView({ block: "center" });
      target?.focus({ preventScroll: true });
    });
  }
  function exportInput(): DerivedTranscriptExport {
    return { brief, revision, segments: displayed.segments, text: displayed.text, uiLocale: locale, translationLanguage: displayedView === "translated" ? taskLanguage : null };
  }
  async function copyText() {
    const input = exportInput();
    try { await writeTextToClipboard(buildDerivedTranscriptCopyText(input)); setExportStatus("copied"); }
    catch { setExportStatus("failed"); }
  }
  async function exportPdf() {
    const input = exportInput();
    setExportStatus("exporting");
    try {
      const { downloadTranscriptPdf, loadTranscriptLogo } = await import("@/lib/download-transcript-pdf");
      await downloadTranscriptPdf(buildDerivedTranscriptPdfDefinition(input, await loadTranscriptLogo()), derivedTranscriptFilename(input));
      setExportStatus("idle");
    } catch { setExportStatus("failed"); }
  }
  return <div className="call-result-panel">
    <section className="call-result-summary" aria-labelledby={`summary-heading-${revision.id}`}>
      <div className="final-transcript-heading">
        <h2 id={`summary-heading-${revision.id}`}>{copy.summary}</h2>
      </div>
      {summary ? <div lang={taskLanguage}><CallSummaryPresentation summary={summary} uiLocale={locale}
        sourceHref={(id) => `#${sourceSegmentAnchor(revision.id, id)}`} onSource={revealSource} /></div>
        : <div role="status"><p>{availabilityMessage ?? (waitingSummary ? (pollingPaused ? copy.pending : copy.summaryLoading) : summaryArtifact ? (summaryArtifact.retryable ? copy.summaryFailed : copy.summaryRetryUnavailable) : !canSummarize ? copy.unsupported : copy.summaryMissing)}</p>
          {!waitingSummary && canSummarize && canRequestTextArtifact(summaryArtifact) ? <button type="button" className="secondary-button" disabled={busy !== null}
            onClick={() => void generate("summary", summaryArtifact?.status === "failed")}>{summaryArtifact ? copy.retry : copy.createSummary}</button> : null}
        </div>}
    </section>

    <section aria-label={copy.originalSource}>
      {translation ? <div className="transcript-version-nav">
        <button type="button" aria-pressed={displayedView === "original"} onClick={() => chooseView("original")}>{copy.original}</button>
        <button type="button" aria-pressed={displayedView === "translated"} onClick={() => chooseView("translated")}>{getTextLanguageLabel(taskLanguage, locale)}</button>
      </div> : null}
      <div className="final-transcript-actions">
        {!translation && !waitingTranslation && canTranslate && canRequestTextArtifact(translationArtifact) ? <button type="button" className="secondary-button" disabled={busy !== null}
          onClick={() => void generate("translation", translationArtifact?.status === "failed")}>{translationArtifact?.status === "failed" ? copy.retry : `${copy.translateTo} ${getTextLanguageLabel(taskLanguage, locale)}`}</button> : null}
        <button type="button" className="transcript-export-button" onClick={() => void copyText()}>{exportStatus === "copied" ? copy.copied : copy.copy}</button>
        <button type="button" className="transcript-export-button" disabled={exportStatus === "exporting"} onClick={() => void exportPdf()}>{exportStatus === "exporting" ? copy.exporting : copy.exportPdf}</button>
      </div>
      {!translation && translationStatusMessage ? <p role={translationArtifact?.status === "failed" ? "alert" : "status"}>{translationStatusMessage}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {availabilityStatus === "error" ? <button type="button" className="secondary-button" onClick={() => void refreshCapabilities()}>{copy.refresh}</button> : null}
      {exportStatus === "failed" ? <p className="form-error" role="alert">{copy.exportError}</p> : null}
      {pollingPaused ? <button type="button" className="secondary-button" onClick={() => void refresh().catch(() => setError(copy.generationError))}>{copy.refresh}</button> : null}
      <p className="transcript-subtitle">{copy.sourceRevision} {revision.revision}{displayedView === "translated" ? ` · ${copy.translationNote}` : ""}</p>
      <div className="final-transcript-body" lang={displayedView === "translated" ? taskLanguage : brief.locale}>
        {displayed.segments.length ? <div className="final-transcript-list">{displayed.segments.map((segment) => <TranscriptLine key={segment.id}
          segment={segment} brief={brief} sourceId={displayedView === "original" ? sourceSegmentAnchor(revision.id, segment.id) : undefined} />)}</div> : <p>{displayed.text}</p>}
        <p className="transcript-warning">{messages.live.aiWarning}</p>
      </div>
    </section>
  </div>;
}

function TranscriptLine({ segment, brief, sourceId }: { segment: SourceSegment; brief: CallBrief; sourceId?: string }) {
  const { messages } = useUiLocale();
  return <article className={`final-transcript-line role-${segment.role}`} id={sourceId} tabIndex={-1}>
    <div className="speaker-mark">{segment.role === "assistant" ? "AI" : segment.role === "recipient" ? "RE" : "?"}</div>
    <div><div className="speaker-row"><strong>{segment.role === "assistant" ? brief.agentName : segment.role === "recipient" ? brief.recipientName : messages.live.unassignedSpeaker}</strong>
      {segment.startSeconds !== null ? <time>~{formatTranscriptOffset(segment.startSeconds)}</time> : null}
    </div><p>{segment.text}</p></div>
  </article>;
}
