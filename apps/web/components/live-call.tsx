"use client";

import {
  SUPPORTED_CALL_LANGUAGES,
  type CallEvent,
  type CallBriefStatus,
  type CallSnapshot,
  type ClarificationAnswer,
  type CreateCallBriefInput
} from "@callassist/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "./app-shell";
import { CallFeedback } from "./call-feedback";
import { CompilationReview } from "./compilation-review";
import { ConfirmDialog } from "./confirm-dialog";
import { CreateCallForm } from "./create-call-form";
import { useUiLocale } from "./ui-locale-provider";
import { isTerminalCallStatus } from "@/lib/call-status";
import { isNearTranscriptBottom } from "@/lib/transcript-scroll";
import {
  callRecordingUrl,
  callEventsUrl,
  approveAndStartCall,
  deleteCallData,
  deleteCallRecording,
  decideApproval,
  getCallPreparationErrorMessage,
  getCallSnapshot,
  recompileCallBrief,
  retryFinalTranscript,
  startCall,
  stopCall,
  ApiError
} from "@/lib/api";
import {
  buildFinalTranscriptCopyText,
  buildFinalTranscriptPdfDefinition,
  finalTranscriptPdfFileName,
  writeTextToClipboard
} from "@/lib/final-transcript-export";
import {
  consumeCallPreparationAttempt,
  getCallPreparationSessionStorage
} from "@/lib/call-preparation-attempt";

const activeStatuses = new Set<CallBriefStatus>([
  "dialing",
  "in_progress",
  "awaiting_approval"
]);

export function LiveCall({ callId }: { callId: string }) {
  const router = useRouter();
  const { locale: uiLocale, localizeHref, messages } = useUiLocale();
  const copy = messages.live;
  const [snapshot, setSnapshot] = useState<CallSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingBrief, setEditingBrief] = useState(false);
  const [confirmingAudioDelete, setConfirmingAudioDelete] = useState(false);
  const [deletionPassword, setDeletionPassword] = useState("");
  const [deletionConfirmation, setDeletionConfirmation] = useState("");
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deletionError, setDeletionError] = useState<
    "invalid-password" | "failed" | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "reconnecting"
  >("connecting");
  const [followLiveTranscript, setFollowLiveTranscript] = useState(true);
  const [showFullObjective, setShowFullObjective] = useState(false);
  const transcriptListRef = useRef<HTMLDivElement>(null);
  const transcriptCardRef = useRef<HTMLElement>(null);
  const deletionRequestIdRef = useRef<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle"
  );
  const [pdfStatus, setPdfStatus] = useState<"idle" | "exporting" | "failed">(
    "idle"
  );
  const [partialTranscript, setPartialTranscript] = useState<
    Record<
      string,
      { role: "assistant" | "recipient"; text: string; locale: string }
    >
  >({});

  const refresh = useCallback(async (reportError = true) => {
    try {
      const nextSnapshot = await getCallSnapshot(callId);
      setSnapshot(nextSnapshot);
      consumeCallPreparationAttempt(getCallPreparationSessionStorage(), callId);
      setLoadError(null);
    } catch {
      if (reportError) setLoadError(messages.live.loadError);
    } finally {
      setLoading(false);
    }
  }, [callId, messages.live.loadError]);

  useEffect(() => {
    void refresh();
    const events = new EventSource(callEventsUrl(callId), {
      withCredentials: true
    });
    events.onopen = () => setConnectionStatus("connected");
    events.onmessage = (message) => {
      let event: CallEvent;
      try {
        event = JSON.parse(message.data) as CallEvent;
      } catch {
        return;
      }

      if (event.type === "transcript.delta") {
        setPartialTranscript((current) => ({
          ...current,
          [event.key]: {
            role: event.role,
            locale: event.locale,
            text: `${current[event.key]?.text ?? ""}${event.delta}`
          }
        }));
        return;
      }

      if (event.type === "transcript.added") {
        setPartialTranscript((current) =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([, partial]) => partial.role !== event.segment.role
            )
          )
        );
      }
      void refresh(false);
    };
    events.onerror = () => setConnectionStatus("reconnecting");
    return () => events.close();
  }, [callId, refresh]);

  const transcriptVersion = `${snapshot?.transcript.length ?? 0}:${Object.values(
    partialTranscript
  ).map(({ text }) => text.length).join(",")}`;

  useEffect(() => {
    const list = transcriptListRef.current;
    if (!list || !followLiveTranscript) return;
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [followLiveTranscript, transcriptVersion]);

  useEffect(() => {
    if (copyStatus === "idle") return;
    const timeout = window.setTimeout(() => setCopyStatus("idle"), 3000);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  useEffect(() => setCopyStatus("idle"), [snapshot?.finalTranscript?.updatedAt]);

  useEffect(() => {
    if (!snapshot?.brief.recipientName) return;
    document.title = messages.live.callPageTitle(snapshot.brief.recipientName);
    return () => {
      document.title = messages.app.defaultTitle;
    };
  }, [messages.app.defaultTitle, messages.live, snapshot?.brief.recipientName]);

  const language = useMemo(
    () =>
      SUPPORTED_CALL_LANGUAGES.find(
        ({ locale }) => locale === snapshot?.brief.locale
      ),
    [snapshot?.brief.locale]
  );

  function revealLiveTranscript() {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        transcriptCardRef.current?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "start"
        });
      });
    });
  }

  async function runAction(
    action: () => Promise<CallSnapshot>,
    onSuccess?: () => void
  ) {
    setBusy(true);
    setActionError(null);
    try {
      setSnapshot(await action());
      onSuccess?.();
    } catch (error) {
      setActionError(
        error instanceof ApiError && error.code === "INSUFFICIENT_CREDITS"
          ? messages.live.insufficientCredits
          : error instanceof ApiError && error.code === "CONCURRENT_CALL_LIMIT"
            ? messages.live.concurrentCall
            : error instanceof ApiError && error.code === "RECIPIENT_SUPPRESSED"
              ? messages.live.recipientSuppressed
              : error instanceof ApiError && error.code === "OUTBOUND_CALLS_DISABLED"
                ? messages.live.outboundCallsDisabled
                : error instanceof ApiError && [
                    "HOURLY_CALL_LIMIT",
                    "DAILY_CALL_LIMIT",
                    "RECIPIENT_REPEAT_LIMIT"
                  ].includes(error.code)
                  ? messages.live.callLimitReached
                  : error instanceof ApiError && error.code === "RATE_LIMITED"
                      ? messages.live.rateLimited
                      : messages.live.actionError
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveEditedBrief(input: CreateCallBriefInput) {
    const updated = await recompileCallBrief(callId, input);
    setSnapshot(updated);
    setEditingBrief(false);
    setActionError(null);
    return updated.brief;
  }

  async function answerClarifications(answers: ClarificationAnswer[]) {
    if (!snapshot?.compilation) return;
    setBusy(true);
    setActionError(null);
    try {
      const previousAnswers = snapshot.compilation.rawBrief.clarificationAnswers ?? [];
      const answerCodes = new Set(answers.map(({ issueCode }) => issueCode));
      const updated = await recompileCallBrief(callId, {
        ...snapshot.compilation.rawBrief,
        clarificationAnswers: [
          ...previousAnswers.filter(({ issueCode }) => !answerCodes.has(issueCode)),
          ...answers
        ]
      });
      setSnapshot(updated);
    } catch (error) {
      setActionError(getCallPreparationErrorMessage(error, {
        rateLimited: messages.live.rateLimited
      }));
    } finally {
      setBusy(false);
    }
  }

  async function copyFinalTranscript() {
    if (!snapshot?.finalTranscript || !language) return;
    try {
      await writeTextToClipboard(
        buildFinalTranscriptCopyText({
          brief: snapshot.brief,
          finalTranscript: snapshot.finalTranscript,
          languageLabel: language.label
        })
      );
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  async function downloadFinalTranscript() {
    if (!snapshot?.finalTranscript || !language) return;
    setPdfStatus("exporting");
    try {
      const input = {
        brief: snapshot.brief,
        finalTranscript: snapshot.finalTranscript,
        languageLabel: language.label
      };
      const { downloadTranscriptPdf } = await import(
        "@/lib/download-transcript-pdf"
      );
      await downloadTranscriptPdf(
        buildFinalTranscriptPdfDefinition(input),
        finalTranscriptPdfFileName(input)
      );
      setPdfStatus("idle");
    } catch (error) {
      console.error("Final transcript PDF export failed", error);
      setPdfStatus("failed");
    }
  }

  async function permanentlyDeleteCallData() {
    setDeletionBusy(true);
    setDeletionError(null);
    try {
      deletionRequestIdRef.current ??= crypto.randomUUID();
      await deleteCallData(callId, {
        requestId: deletionRequestIdRef.current,
        password: deletionPassword,
        confirmation: "DELETE"
      });
      router.replace(localizeHref("/app"));
      router.refresh();
    } catch (error) {
      setDeletionError(
        error instanceof ApiError && error.code === "INVALID_CREDENTIALS"
          ? "invalid-password"
          : "failed"
      );
      setDeletionBusy(false);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <main className="live-page" id="main-content" tabIndex={-1}><div className="loading-card">{copy.loadingBrief}</div></main>
      </AppShell>
    );
  }

  if (!snapshot) {
    return (
      <AppShell>
        <main className="live-page" id="main-content" tabIndex={-1}>
          <div className="loading-card">
            <strong>{copy.unavailableTitle}</strong>
            <p>{loadError}</p>
            <Link href={localizeHref("/app")}>{copy.returnDashboard}</Link>
          </div>
        </main>
      </AppShell>
    );
  }

  const {
    brief,
    compilation,
    transcript,
    pendingApproval,
    recording,
    finalTranscript
  } = snapshot;
  const finalSegments = finalTranscript?.segments ?? [];
  const isActive = activeStatuses.has(brief.status);
  const isTerminal = isTerminalCallStatus(brief.status);

  return (
    <AppShell>
      <main className="live-page" id="main-content" tabIndex={-1}>
        <div className="live-nav">
          <nav aria-label={messages.live.breadcrumbLabel} className="breadcrumbs">
            <ol>
              <li><Link href={localizeHref("/app")}>{messages.live.allCallBriefs}</Link></li>
              <li aria-current="page">{brief.recipientName}</li>
            </ol>
          </nav>
          <span className={`status-pill status-${brief.status}`}>
            <span aria-hidden="true" /> {copy.status[brief.status]}
          </span>
        </div>

        <section className="call-hero">
          <div>
            <span className="eyebrow">{copy.activeBrief}</span>
            <h1>{brief.recipientName}</h1>
            <div className="call-meta">
              <span>{brief.phoneNumber}</span>
              <span className="meta-divider" />
              <span>{language?.label ?? brief.locale}</span>
            </div>
          </div>

          <div className="call-actions">
            {brief.status === "ready" ? (
              <button
                className="primary-button compact-button"
                disabled={busy}
                onClick={() => runAction(() => startCall(callId), revealLiveTranscript)}
                type="button"
              >
                <span className="button-signal" aria-hidden="true">◖</span>
                {copy.startCall}
              </button>
            ) : null}
            {isActive ? (
              <button
                className="danger-button"
                disabled={busy}
                onClick={() => runAction(() => stopCall(callId))}
                type="button"
              >
                <span aria-hidden="true">■</span> {copy.stopCall}
              </button>
            ) : null}
          </div>
        </section>

        {actionError ? <div className="inline-notice" role="alert">{actionError}</div> : null}

        {compilation && editingBrief ? (
          <CreateCallForm
            heading={copy.updateHeading}
            initialValue={compilation.rawBrief}
            onCancel={() => setEditingBrief(false)}
            onCreated={() => undefined}
            saveCallBrief={saveEditedBrief}
            submitLabel={copy.updatePlan}
          />
        ) : compilation ? (
          <CompilationReview
            busy={busy}
            compilation={compilation}
            onAnswerClarifications={answerClarifications}
            onApproveAndCall={() =>
              runAction(() => approveAndStartCall(callId), revealLiveTranscript)
            }
            onEdit={() => setEditingBrief(true)}
            recipientName={brief.recipientName}
            showActions={!isTerminal}
          />
        ) : brief.status === "blocked" ? (
          <section className="compilation-review decision-blocked">
            <span className="eyebrow">{copy.legacyBrief}</span>
            <h2>{copy.legacyTitle}</h2>
            <p>{copy.legacyHelp}</p>
          </section>
        ) : null}

        <div
          className={`live-grid ${
            ["review_required", "needs_clarification", "blocked"].includes(
              brief.status
            )
              ? "precall-hidden"
              : ""
          }`}
        >
          <div className="transcript-column">
            <section className="transcript-card" ref={transcriptCardRef}>
            <div className="transcript-heading">
              <div>
                <span className="eyebrow">{copy.liveTranscriptEyebrow}</span>
                <h2>{copy.liveCaptions}</h2>
                <p className="transcript-subtitle">{copy.liveTranscriptHelp}</p>
              </div>
              {isActive ? (
                <div
                  className={`connection-status connection-${connectionStatus}`}
                  role="status"
                >
                  <span aria-hidden="true" />
                  {messages.live[connectionStatus]}
                </div>
              ) : null}
            </div>

            <div
              className="transcript-list"
              aria-live="polite"
              onScroll={(event) => {
                const list = event.currentTarget;
                setFollowLiveTranscript(isNearTranscriptBottom(list));
              }}
              ref={transcriptListRef}
            >
              {transcript.length === 0 &&
              Object.keys(partialTranscript).length === 0 ? (
                <div className="transcript-empty">
                  <span className="wave-placeholder" aria-hidden="true">
                    <i /><i /><i /><i /><i />
                  </span>
                  <strong>{copy.transcriptEmptyTitle}</strong>
                  <p>{copy.transcriptEmptyHelp}</p>
                </div>
              ) : (
                <>
                  {transcript.map((segment) => (
                  <article className={`transcript-line role-${segment.role}`} key={segment.id}>
                    <div className="speaker-mark">
                      {segment.role === "assistant" ? "AI" : "RE"}
                    </div>
                    <div>
                      <div className="speaker-row">
                        <strong>
                          {segment.role === "assistant" ? "CallAssist" : brief.recipientName}
                        </strong>
                        <time>
                          {new Date(segment.createdAt).toLocaleTimeString(uiLocale, {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit"
                          })}
                        </time>
                      </div>
                      <p>{segment.text}</p>
                      <span className="locale-tag">{segment.locale}</span>
                    </div>
                  </article>
                  ))}
                  {Object.entries(partialTranscript).map(([key, segment]) => (
                    <article
                      className={`transcript-line role-${segment.role}`}
                      key={key}
                    >
                      <div className="speaker-mark">
                        {segment.role === "assistant" ? "AI" : "RE"}
                      </div>
                      <div>
                        <div className="speaker-row">
                          <strong>
                            {segment.role === "assistant"
                              ? brief.agentName
                              : brief.recipientName}
                          </strong>
                          <time>{copy.liveTime}</time>
                        </div>
                        <p>{segment.text}…</p>
                        <span className="locale-tag">{segment.locale}</span>
                      </div>
                    </article>
                  ))}
                </>
              )}
            </div>
            {!followLiveTranscript &&
            (transcript.length > 0 || Object.keys(partialTranscript).length > 0) ? (
              <button
                className="jump-to-latest"
                onClick={() => {
                  setFollowLiveTranscript(true);
                  const list = transcriptListRef.current;
                  if (list) {
                    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
                  }
                }}
                type="button"
              >
                ↓ {messages.live.jumpToLatest}
              </button>
            ) : null}
            </section>

            <section className="final-transcript-card">
              <div className="final-transcript-heading">
                <div>
                  <span className="eyebrow">
                    {copy.finalEyebrow}
                  </span>
                  <h2>{copy.finalTitle}</h2>
                  <p className="transcript-subtitle">{copy.finalHelp}</p>
                </div>
                {finalTranscript ? (
                  <span
                    className={`processing-badge final-${finalTranscript.status}`}
                  >
                    {copy.finalTranscriptStatus[finalTranscript.status]}
                  </span>
                ) : null}
              </div>

              {finalTranscript?.status === "completed" &&
              (finalTranscript.text || finalSegments.length > 0) ? (
                <div className="final-transcript-body">
                  <div className="final-transcript-actions">
                    <button
                      className="transcript-export-button"
                      onClick={() => void copyFinalTranscript()}
                      type="button"
                    >
                      <CopyIcon />
                      {copyStatus === "copied"
                        ? messages.live.copied
                        : copyStatus === "failed"
                          ? messages.live.copyFailed
                          : messages.live.copyTranscript}
                    </button>
                    <button
                      className="transcript-export-button"
                      disabled={pdfStatus === "exporting"}
                      onClick={() => void downloadFinalTranscript()}
                      type="button"
                    >
                      <FileDownloadIcon />
                      {pdfStatus === "exporting"
                        ? copy.preparingPdf
                        : pdfStatus === "failed"
                          ? copy.pdfFailed
                          : copy.downloadPdf}
                    </button>
                    <span className="sr-only" aria-live="polite">
                      {copyStatus === "copied"
                        ? messages.live.copiedAnnouncement
                        : copyStatus === "failed"
                          ? messages.live.copyFailedAnnouncement
                          : pdfStatus === "failed"
                            ? copy.pdfFailedAnnouncement
                            : ""}
                    </span>
                  </div>
                  {finalSegments.length > 0 ? (
                    <div className="final-transcript-list">
                      {finalSegments.map((segment, index) => (
                        <article
                          className={`final-transcript-line role-${segment.role}`}
                          key={`${segment.startSeconds}-${segment.role}-${index}`}
                        >
                          <div className="speaker-mark">
                            {segment.role === "assistant"
                              ? "AI"
                              : segment.role === "recipient"
                                ? "RE"
                                : "?"}
                          </div>
                          <div>
                            <div className="speaker-row">
                              <strong>
                                {segment.role === "assistant"
                                  ? brief.agentName
                                  : segment.role === "recipient"
                                    ? brief.recipientName
                                    : copy.unassignedSpeaker}
                              </strong>
                              <time>~{formatOffset(segment.startSeconds)}</time>
                            </div>
                            <p>{segment.text}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="legacy-final-transcript">
                      <strong>{copy.fullRecordingTranscript}</strong>
                      <p>{finalTranscript.text}</p>
                    </div>
                  )}
                  <small>
                    {finalSegments.length > 0
                      ? copy.structuredTranscriptNote
                      : copy.plainTranscriptNote}{" "}
                    {copy.aiWarning}
                  </small>
                  {recording?.status === "available" ? (
                    <button
                      className="secondary-button regenerate-button"
                      disabled={busy}
                      onClick={() =>
                        runAction(() => retryFinalTranscript(callId))
                      }
                      type="button"
                    >
                      {copy.regenerateTranscript}
                    </button>
                  ) : null}
                </div>
              ) : finalTranscript?.status === "failed" ? (
                <div className="final-transcript-state state-error">
                  <strong>{copy.finalFailed}</strong>
                  <p>{copy.finalFailedHelp}</p>
                  <button
                    className="secondary-button"
                    disabled={busy || recording?.status !== "available"}
                    onClick={() => runAction(() => retryFinalTranscript(callId))}
                    type="button"
                  >
                    {copy.retryTranscription}
                  </button>
                </div>
              ) : finalTranscript?.status === "processing" ||
                recording?.status === "processing" ||
                recording?.status === "available" ? (
                <div className="final-transcript-state">
                  <span className="processing-spinner" aria-hidden="true" />
                  <strong>{copy.creatingFinal}</strong>
                  <p>{copy.creatingFinalHelp}</p>
                </div>
              ) : recording?.status === "failed" ? (
                <div className="final-transcript-state state-error">
                  <strong>{copy.recordingNotStarted}</strong>
                  <p>{copy.recordingNotStartedHelp}</p>
                </div>
              ) :
                !recording &&
                ["completed", "stopped", "failed"].includes(brief.status) ? (
                <div className="final-transcript-state">
                  <strong>{copy.noRecording}</strong>
                  <p>{copy.noRecordingHelp}</p>
                </div>
              ) : (
                <div className="final-transcript-state">
                  <strong>{copy.availableAfterCall}</strong>
                  <p>{copy.availableAfterCallHelp}</p>
                </div>
              )}

              {recording ? (
                <div className="recording-panel">
                  <div>
                    <strong>{copy.consentAudio}</strong>
                    <span>
                      {recording.status === "deleted"
                        ? copy.deleted
                        : recording.status === "available"
                          ? `${copy.available}${recording.durationSeconds !== null ? ` · ${formatDuration(recording.durationSeconds)}` : ""}`
                          : copy.recordingStatus[recording.status]}
                    </span>
                  </div>
                  {recording.status === "available" ? (
                    <>
                      <audio controls crossOrigin="use-credentials" preload="metadata" src={callRecordingUrl(callId)}>
                        {copy.audioUnsupported}
                      </audio>
                      <button
                        className="text-button danger-text"
                        disabled={
                          busy || finalTranscript?.status === "processing"
                        }
                        onClick={() => setConfirmingAudioDelete(true)}
                        type="button"
                      >
                        {copy.deleteAudioNow}
                      </button>
                    </>
                  ) : null}
                  <small>
                    {recording.status === "deleted"
                      ? copy.audioDeleted
                      : retentionLabel(brief.audioRetentionDays, recording.deleteAfter, uiLocale, copy)}
                  </small>
                </div>
              ) : null}
            </section>

            {isTerminalCallStatus(brief.status) && brief.status !== "blocked" ? (
              <CallFeedback
                callId={callId}
                hasCompletedTranscript={finalTranscript?.status === "completed"}
              />
            ) : null}

            {isTerminalCallStatus(brief.status) || brief.status === "blocked" ? (
              <section className="call-data-deletion-card" aria-labelledby="call-data-deletion-title">
                <h2 id="call-data-deletion-title">{copy.dataDeletionTitle}</h2>
                <p>{copy.dataDeletionText}</p>
                <p className="account-muted">{copy.dataDeletionRetained}</p>
                <div className="call-data-deletion-fields">
                  <label>
                    <span>{copy.dataDeletionPassword}</span>
                    <input
                      autoComplete="current-password"
                      disabled={deletionBusy}
                      onChange={(event) => setDeletionPassword(event.target.value)}
                      type="password"
                      value={deletionPassword}
                    />
                  </label>
                  <label>
                    <span>{copy.dataDeletionConfirmation}</span>
                    <input
                      autoCapitalize="characters"
                      autoComplete="off"
                      disabled={deletionBusy}
                      onChange={(event) => setDeletionConfirmation(event.target.value)}
                      spellCheck={false}
                      type="text"
                      value={deletionConfirmation}
                    />
                    <small>{copy.dataDeletionConfirmationHint}</small>
                  </label>
                </div>
                <button
                  className="danger-button"
                  disabled={
                    deletionBusy ||
                    !deletionPassword ||
                    deletionConfirmation !== "DELETE"
                  }
                  onClick={() => void permanentlyDeleteCallData()}
                  type="button"
                >
                  {deletionBusy
                    ? copy.dataDeletionBusy
                    : copy.dataDeletionAction}
                </button>
                {deletionError ? (
                  <p className="form-error" role="alert">
                    {deletionError === "invalid-password"
                      ? copy.dataDeletionInvalidPassword
                      : copy.dataDeletionError}
                  </p>
                ) : null}
              </section>
            ) : null}
          </div>

          <aside className="call-sidebar">
            {pendingApproval ? (
              <section className="approval-card">
                <div className="approval-icon" aria-hidden="true">!</div>
                <span className="eyebrow">{copy.decisionRequired}</span>
                <h2>{pendingApproval.title}</h2>
                <p>{pendingApproval.reason}</p>
                <div className="speech-preview">
                  <span>{copy.assistantWillSay}</span>
                  <blockquote>“{pendingApproval.proposedSpeech}”</blockquote>
                </div>
                <div className="approval-actions">
                  <button
                    className="approve-button"
                    disabled={busy}
                    onClick={() =>
                      runAction(() =>
                        decideApproval(callId, pendingApproval.id, "approved")
                      )
                    }
                    type="button"
                  >
                    {copy.approve}
                  </button>
                  <button
                    className="decline-button"
                    disabled={busy}
                    onClick={() =>
                      runAction(() =>
                        decideApproval(callId, pendingApproval.id, "declined")
                      )
                    }
                    type="button"
                  >
                    {copy.doNotDisclose}
                  </button>
                </div>
              </section>
            ) : isTerminal ? (
              <section className="guard-card terminal-summary">
                <div className="guard-visual" aria-hidden="true">
                  <span>{brief.status === "failed" ? "!" : "✓"}</span>
                </div>
                <h2>{copy.status[brief.status]}</h2>
                <p>{copy.terminalHelp}</p>
              </section>
            ) : (
              <section className="guard-card">
                <div className="guard-visual" aria-hidden="true">
                  <span>✓</span>
                </div>
                <h2>{copy.safetyActive}</h2>
                <p>{copy.safetyHelp}</p>
              </section>
            )}

            <section className="brief-card">
              <span className="eyebrow">{copy.briefEyebrow}</span>
              <h2>{copy.objectiveTitle}</h2>
              <p className={showFullObjective ? "" : "objective-clamped"}>{brief.objective}</p>
              {brief.objective.length > 180 ? (
                <button
                  aria-expanded={showFullObjective}
                  className="objective-toggle"
                  onClick={() => setShowFullObjective((current) => !current)}
                  type="button"
                >
                  {showFullObjective
                    ? messages.live.hideObjective
                    : messages.live.showObjective}
                </button>
              ) : null}
              <dl>
                <div><dt>{copy.primaryLanguage}</dt><dd>{brief.locale}</dd></div>
                <div>
                  <dt>{copy.languageSwitching}</dt>
                  <dd>{brief.allowLanguageSwitch ? brief.fallbackLocale : copy.disabled}</dd>
                </div>
                <div>
                  <dt>{copy.voice}</dt>
                  <dd>{brief.voiceGender === "female" ? copy.female : copy.male}</dd>
                </div>
                <div>
                  <dt>{copy.assistanceReason}</dt>
                  <dd>
                    {brief.assistanceReason === "language_barrier"
                      ? copy.languageBarrier
                      : copy.speechImpairment}
                  </dd>
                </div>
                <div>
                  <dt>{copy.audioRetention}</dt>
                  <dd>
                    {brief.audioRetentionDays === 0
                      ? copy.untilFinalTranscript
                      : copy.retentionDays(brief.audioRetentionDays)}
                  </dd>
                </div>
                <div><dt>{copy.assistant}</dt><dd>{brief.agentName}</dd></div>
              </dl>
            </section>
          </aside>
        </div>
        <ConfirmDialog
          busy={busy}
          confirmLabel={messages.call.deleteAudioConfirm}
          danger
          description={messages.call.deleteAudioBody}
          onCancel={() => setConfirmingAudioDelete(false)}
          onConfirm={() => {
            setConfirmingAudioDelete(false);
            void runAction(() => deleteCallRecording(callId));
          }}
          open={confirmingAudioDelete}
          title={messages.call.deleteAudioTitle}
        />
      </main>
    </AppShell>
  );
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function formatOffset(seconds: number) {
  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  return `${minutes}:${(rounded % 60).toString().padStart(2, "0")}`;
}

function retentionLabel(
  days: number,
  deleteAfter: string | null,
  locale: "en" | "de",
  copy: {
    retentionImmediate: string;
    retentionScheduled: (date: string) => string;
    retentionAutomatic: (days: number) => string;
  }
) {
  if (days === 0) return copy.retentionImmediate;
  if (deleteAfter) {
    const formattedDate = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium"
    }).format(new Date(deleteAfter));
    return copy.retentionScheduled(formattedDate);
  }
  return copy.retentionAutomatic(days);
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      className="transcript-action-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <rect height="13" rx="2" width="13" x="8" y="8" />
      <path
        d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"
      />
    </svg>
  );
}

function FileDownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      className="transcript-action-icon"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      <path d="M14 2.75H6.5a2 2 0 0 0-2 2v14.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.25z" />
      <path d="M14 2.75v5.5h5.5" />
      <path d="M12 11.5v6" />
      <path d="m9.5 15 2.5 2.5 2.5-2.5" />
    </svg>
  );
}
