"use client";

import { type CallCompilation, type CallLanguageContext, type CallTextArtifact, type ClarificationAnswer, type PlanSource, type ReviewEvidence } from "@callassist/contracts";
import { useEffect, useRef, useState } from "react";
import { ApiError, requestPlanReview, retryCallTextArtifact } from "@/lib/api";
import { canRequestTextArtifact } from "@/lib/text-artifact-retry";
import { currentPlanReviewArtifact, projectPlanReview } from "@/lib/plan-review-projection";
import { planReviewLanguage } from "@/lib/plan-review-language";
import { getCallLanguageLabel, getTextLanguageLabel } from "@/lib/i18n/language-messages";
import { textArtifactMessages } from "@/lib/i18n/text-artifact-messages";
import { CompilationReview } from "./compilation-review";
import { useUiLocale } from "./ui-locale-provider";
import { useCallTextArtifacts } from "./use-call-text-artifacts";
import { useCallDraftStore } from "./call-draft-provider";
import { canGenerateText, useTextCapabilities } from "./use-text-capabilities";

export function TranslatedPlanReview({ callId, userId, compilation, source, languageContext, initialArtifacts, ...reviewProps }: {
  callId: string; userId: string; compilation: CallCompilation; source: PlanSource;
  languageContext: CallLanguageContext; initialArtifacts?: CallTextArtifact[];
  busy: boolean; recipientName: string; showActions?: boolean; callDetails?: Array<{ label: string; value: string }>;
  onAnswerClarifications: (answers: ClarificationAnswer[]) => Promise<void>;
  onApproveAndCall: (review: ReviewEvidence) => void; onEdit: () => void; onRetryPreparation?: () => void;
}) {
  const { locale } = useUiLocale();
  const copy = textArtifactMessages[locale];
  const { capabilities, availabilityStatus, refreshCapabilities } = useTextCapabilities();
  const store = useCallDraftStore();
  const viewKey = `review:${callId}:${source.compilationId}:${languageContext.selectionRevision}`;
  const callLocale = compilation.rawBrief.locale;
  const { kind, sourceLanguage, needsTranslation } = planReviewLanguage(compilation, languageContext);
  const [view, setView] = useState<"original" | "translated">(() =>
    store.getView(userId, viewKey) === "original" ? "original" : needsTranslation ? "translated" : "original");
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const started = useRef(false);
  const { items, remember, refresh, pollingPaused } = useCallTextArtifacts(callId, initialArtifacts);
  const artifact = currentPlanReviewArtifact(items, compilation, source, languageContext.taskContentLanguage, kind);
  const projection = artifact ? projectPlanReview(compilation, source, artifact) : null;
  const canGenerate = availabilityStatus === "ready" && canGenerateText(capabilities, kind, sourceLanguage, languageContext.taskContentLanguage);

  async function request(retry = false) {
    setError(null); setRequesting(true);
    try {
      remember(retry && artifact ? await retryCallTextArtifact(callId, artifact.id) : await requestPlanReview(callId, {
        compilationId: source.compilationId, revision: source.revision, snapshotHash: source.snapshotHash,
        targetLanguage: languageContext.taskContentLanguage
      }));
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 422 ? copy.unsupported
        : caught instanceof ApiError && caught.status === 429 ? copy.rateLimited : copy.failed);
    } finally { setRequesting(false); }
  }
  useEffect(() => {
    if (!canGenerate || !needsTranslation || view !== "translated" || artifact || started.current) return;
    started.current = true;
    void request();
    // The parent keys this component by source and language-selection revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canGenerate, needsTranslation, view, artifact]);

  const ready = view === "original" || Boolean(projection);
  const evidence: ReviewEvidence = view === "translated" && artifact?.payloadHash
    ? { mode: "translated", language: languageContext.taskContentLanguage, artifactId: artifact.id, artifactHash: artifact.payloadHash, selectionRevision: languageContext.selectionRevision }
    : { mode: "original", language: callLocale, selectionRevision: languageContext.selectionRevision };
  function select(next: "original" | "translated") {
    store.setView(userId, viewKey, next); setView(next);
  }
  return <div>
    <div className="transcript-version-nav" aria-label={copy.originalPlan}>
      {needsTranslation ? <button type="button" aria-pressed={view === "translated"} onClick={() => select("translated")}>{getTextLanguageLabel(languageContext.taskContentLanguage, locale)}</button> : null}
      <button type="button" aria-pressed={view === "original"} onClick={() => select("original")}>{copy.originalPlan} — {getCallLanguageLabel(callLocale, locale)}</button>
    </div>
    {!ready ? <div className="final-transcript-state" role={error || artifact?.status === "failed" ? "alert" : "status"}>
      <p>{error ?? (artifact?.status === "stale" ? copy.stale : artifact?.status === "ready" ? copy.failed
        : availabilityStatus === "loading" && !artifact ? copy.checkingAvailability
        : availabilityStatus === "error" ? copy.availabilityError
        : capabilities?.textGenerationEnabled === false ? copy.generationDisabled
        : !canGenerate && !artifact ? copy.unsupported
        : artifact?.status === "failed" || artifact?.status === "cancelled" ? (artifact.retryable ? copy.failed : copy.reviewRetryUnavailable) : pollingPaused ? copy.pending : copy.loading)}</p>
      {availabilityStatus === "error" ? <button type="button" className="secondary-button" onClick={() => void refreshCapabilities()}>{copy.refresh}</button> : null}
      {canGenerate && canRequestTextArtifact(artifact) && (error || artifact?.status === "failed") ? <button type="button" className="secondary-button" disabled={requesting} onClick={() => void request(artifact?.status === "failed")}>{copy.retry}</button> : null}
      {pollingPaused ? <button type="button" className="secondary-button" onClick={() => void refresh().catch(() => setError(copy.failed))}>{copy.refresh}</button> : null}
    </div> : <div lang={view === "original" ? callLocale : languageContext.taskContentLanguage}>
      <CompilationReview {...reviewProps} compilation={view === "translated" ? projection! : compilation}
        onApproveAndCall={() => { if (ready) reviewProps.onApproveAndCall(evidence); }} />
    </div>}
  </div>;
}
