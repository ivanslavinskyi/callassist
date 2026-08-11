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
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "./app-shell";
import { CompilationReview } from "./compilation-review";
import { CreateCallForm } from "./create-call-form";
import {
  callRecordingUrl,
  callEventsUrl,
  approveAndStartCall,
  deleteCallRecording,
  decideApproval,
  getCallSnapshot,
  recompileCallBrief,
  retryFinalTranscript,
  startCall,
  stopCall
} from "@/lib/api";
import {
  buildFinalTranscriptCopyText,
  buildFinalTranscriptPdfDefinition,
  finalTranscriptPdfFileName,
  writeTextToClipboard
} from "@/lib/final-transcript-export";

const statusLabels: Record<CallBriefStatus, string> = {
  review_required: "Ready to call",
  needs_clarification: "Needs one detail",
  blocked: "Blocked by policy",
  ready: "Ready to start",
  dialing: "Dialing",
  in_progress: "Call in progress",
  awaiting_approval: "Awaiting decision",
  completed: "Call completed",
  stopped: "Call stopped",
  failed: "Call failed"
};

const activeStatuses = new Set<CallBriefStatus>([
  "dialing",
  "in_progress",
  "awaiting_approval"
]);

export function LiveCall({ callId }: { callId: string }) {
  const [snapshot, setSnapshot] = useState<CallSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingBrief, setEditingBrief] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await getCallSnapshot(callId));
      setError(null);
    } catch {
      setError("The call brief was not found or the API is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [callId]);

  useEffect(() => {
    void refresh();
    const events = new EventSource(callEventsUrl(callId));
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
      void refresh();
    };
    events.onerror = () => setError("The live connection is reconnecting…");
    return () => events.close();
  }, [callId, refresh]);

  const language = useMemo(
    () =>
      SUPPORTED_CALL_LANGUAGES.find(
        ({ locale }) => locale === snapshot?.brief.locale
      ),
    [snapshot?.brief.locale]
  );

  async function runAction(action: () => Promise<CallSnapshot>) {
    setBusy(true);
    setError(null);
    try {
      setSnapshot(await action());
    } catch {
      setError("The action could not be completed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEditedBrief(input: CreateCallBriefInput) {
    const updated = await recompileCallBrief(callId, input);
    setSnapshot(updated);
    setEditingBrief(false);
    setError(null);
    return updated.brief;
  }

  async function answerClarifications(answers: ClarificationAnswer[]) {
    if (!snapshot?.compilation) return;
    setBusy(true);
    setError(null);
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
    } catch {
      setError("The clarification could not be saved. Try again.");
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

  if (loading) {
    return (
      <AppShell>
        <main className="live-page"><div className="loading-card">Loading call brief…</div></main>
      </AppShell>
    );
  }

  if (!snapshot) {
    return (
      <AppShell>
        <main className="live-page">
          <div className="loading-card">
            <strong>Call brief unavailable</strong>
            <p>{error}</p>
            <Link href="/">Return to dashboard</Link>
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

  return (
    <AppShell>
      <main className="live-page">
        <div className="live-nav">
          <Link className="back-link" href="/">← All call briefs</Link>
          <span className={`status-pill status-${brief.status}`}>
            <span aria-hidden="true" /> {statusLabels[brief.status]}
          </span>
        </div>

        <section className="call-hero">
          <div>
            <span className="eyebrow">Active call brief</span>
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
                onClick={() => runAction(() => startCall(callId))}
                type="button"
              >
                <span className="button-signal" aria-hidden="true">◖</span>
                Start call
              </button>
            ) : null}
            {isActive ? (
              <button
                className="danger-button"
                disabled={busy}
                onClick={() => runAction(() => stopCall(callId))}
                type="button"
              >
                <span aria-hidden="true">■</span> Stop call
              </button>
            ) : null}
          </div>
        </section>

        {error ? <div className="inline-notice">{error}</div> : null}

        {compilation && editingBrief ? (
          <CreateCallForm
            heading="Update this call"
            initialValue={compilation.rawBrief}
            onCancel={() => setEditingBrief(false)}
            onCreated={() => undefined}
            saveCallBrief={saveEditedBrief}
            submitLabel="Update call plan"
          />
        ) : compilation ? (
          <CompilationReview
            busy={busy}
            compilation={compilation}
            onAnswerClarifications={answerClarifications}
            onApproveAndCall={() =>
              runAction(() => approveAndStartCall(callId))
            }
            onEdit={() => setEditingBrief(true)}
          />
        ) : brief.status === "blocked" ? (
          <section className="compilation-review decision-blocked">
            <span className="eyebrow">Legacy call brief</span>
            <h2>This brief cannot be started</h2>
            <p>
              It was created before the compiler and policy boundary. Recreate it
              from the dashboard to generate a reviewable call plan.
            </p>
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
            <section className="transcript-card">
            <div className="transcript-heading">
              <div>
                <span className="eyebrow">Live transcript · realtime draft</span>
                <h2>Live captions</h2>
                <p className="transcript-subtitle">
                  Appears during the call. Fast, provisional, and may contain
                  recognition errors.
                </p>
              </div>
              {isActive ? (
                <div className="live-indicator"><span /><span /><span /></div>
              ) : null}
            </div>

            <div className="transcript-list" aria-live="polite">
              {transcript.length === 0 &&
              Object.keys(partialTranscript).length === 0 ? (
                <div className="transcript-empty">
                  <span className="wave-placeholder" aria-hidden="true">
                    <i /><i /><i /><i /><i />
                  </span>
                  <strong>The transcript will appear here</strong>
                  <p>
                    After the recipient consents, each turn will appear here in
                    real time. This fast transcript may contain recognition errors.
                  </p>
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
                          {new Date(segment.createdAt).toLocaleTimeString("en-GB", {
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
                          <time>live</time>
                        </div>
                        <p>{segment.text}…</p>
                        <span className="locale-tag">{segment.locale}</span>
                      </div>
                    </article>
                  ))}
                </>
              )}
            </div>
            </section>

            <section className="final-transcript-card">
              <div className="final-transcript-heading">
                <div>
                  <span className="eyebrow">
                    Final transcript · recording-based
                  </span>
                  <h2>Post-call transcription</h2>
                  <p className="transcript-subtitle">
                    Created after the call from the consented dual-channel
                    recording.
                  </p>
                </div>
                {finalTranscript ? (
                  <span
                    className={`processing-badge final-${finalTranscript.status}`}
                  >
                    {finalTranscript.status}
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
                        ? "Copied"
                        : copyStatus === "failed"
                          ? "Copy failed — retry"
                          : "Copy transcript"}
                    </button>
                    <button
                      className="transcript-export-button"
                      disabled={pdfStatus === "exporting"}
                      onClick={() => void downloadFinalTranscript()}
                      type="button"
                    >
                      <FileDownloadIcon />
                      {pdfStatus === "exporting"
                        ? "Preparing PDF…"
                        : pdfStatus === "failed"
                          ? "PDF failed — retry"
                          : "Download PDF"}
                    </button>
                    <span className="sr-only" aria-live="polite">
                      {copyStatus === "copied"
                        ? "Final transcript copied to clipboard."
                        : copyStatus === "failed"
                          ? "The final transcript could not be copied."
                          : pdfStatus === "failed"
                            ? "The PDF could not be created."
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
                                    : "Unassigned speaker"}
                              </strong>
                              <time>{formatOffset(segment.startSeconds)}</time>
                            </div>
                            <p>{segment.text}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="legacy-final-transcript">
                      <strong>Legacy unstructured transcript</strong>
                      <p>{finalTranscript.text}</p>
                    </div>
                  )}
                  <small>
                    Speaker roles come from the separate Twilio audio channels;
                    the wording comes from post-call speech recognition. It is
                    independent from the live draft, but remains AI-generated.
                    Check critical details against the audio.
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
                      {finalSegments.length > 0
                        ? "Regenerate final transcript"
                        : "Regenerate with speakers and timestamps"}
                    </button>
                  ) : null}
                </div>
              ) : finalTranscript?.status === "failed" ? (
                <div className="final-transcript-state state-error">
                  <strong>Final transcription failed</strong>
                  <p>The recording is still available. You can retry safely.</p>
                  <button
                    className="secondary-button"
                    disabled={busy || recording?.status !== "available"}
                    onClick={() => runAction(() => retryFinalTranscript(callId))}
                    type="button"
                  >
                    Retry transcription
                  </button>
                </div>
              ) : finalTranscript?.status === "processing" ||
                recording?.status === "processing" ||
                recording?.status === "available" ? (
                <div className="final-transcript-state">
                  <span className="processing-spinner" aria-hidden="true" />
                  <strong>Creating the final transcript</strong>
                  <p>The complete recording is being processed after the call.</p>
                </div>
              ) : recording?.status === "failed" ? (
                <div className="final-transcript-state state-error">
                  <strong>Recording was not started</strong>
                  <p>The conversation did not continue after consent.</p>
                </div>
              ) :
                !recording &&
                ["completed", "stopped", "failed"].includes(brief.status) ? (
                <div className="final-transcript-state">
                  <strong>No recording available</strong>
                  <p>
                    The call ended before a consent-gated recording was started.
                  </p>
                </div>
              ) : (
                <div className="final-transcript-state">
                  <strong>Available after the call</strong>
                  <p>
                    Recording begins only after consent. The final transcript is
                    generated when Twilio finishes the recording.
                  </p>
                </div>
              )}

              {recording ? (
                <div className="recording-panel">
                  <div>
                    <strong>Consent-gated audio</strong>
                    <span>
                      {recording.status === "deleted"
                        ? "Deleted"
                        : recording.status === "available"
                          ? `Available${recording.durationSeconds !== null ? ` · ${formatDuration(recording.durationSeconds)}` : ""}`
                          : recording.status}
                    </span>
                  </div>
                  {recording.status === "available" ? (
                    <>
                      <audio controls preload="metadata" src={callRecordingUrl(callId)}>
                        Your browser does not support audio playback.
                      </audio>
                      <button
                        className="text-button danger-text"
                        disabled={
                          busy || finalTranscript?.status === "processing"
                        }
                        onClick={() => runAction(() => deleteCallRecording(callId))}
                        type="button"
                      >
                        Delete audio now
                      </button>
                    </>
                  ) : null}
                  <small>
                    {recording.status === "deleted"
                      ? "The provider audio has been permanently deleted."
                      : retentionLabel(brief.audioRetentionDays, recording.deleteAfter)}
                  </small>
                </div>
              ) : null}
            </section>
          </div>

          <aside className="call-sidebar">
            {pendingApproval ? (
              <section className="approval-card">
                <div className="approval-icon" aria-hidden="true">!</div>
                <span className="eyebrow">Decision required</span>
                <h2>{pendingApproval.title}</h2>
                <p>{pendingApproval.reason}</p>
                <div className="speech-preview">
                  <span>The assistant will say</span>
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
                    Approve
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
                    Do not disclose
                  </button>
                </div>
              </section>
            ) : (
              <section className="guard-card">
                <div className="guard-visual" aria-hidden="true">
                  <span>✓</span>
                </div>
                <h2>Safety gate active</h2>
                <p>Private data cannot enter the conversation without your approval.</p>
              </section>
            )}

            <section className="brief-card">
              <span className="eyebrow">Call brief</span>
              <h2>Call objective</h2>
              <p>{brief.objective}</p>
              <dl>
                <div><dt>Primary language</dt><dd>{brief.locale}</dd></div>
                <div>
                  <dt>Language switching</dt>
                  <dd>{brief.allowLanguageSwitch ? brief.fallbackLocale : "Disabled"}</dd>
                </div>
                <div>
                  <dt>Voice</dt>
                  <dd>{brief.voiceGender === "female" ? "Female" : "Male"}</dd>
                </div>
                <div>
                  <dt>Reason for assistance</dt>
                  <dd>
                    {brief.assistanceReason === "language_barrier"
                      ? "Language barrier"
                      : "Speech impairment"}
                  </dd>
                </div>
                <div>
                  <dt>Audio retention</dt>
                  <dd>
                    {brief.audioRetentionDays === 0
                      ? "Until final transcript"
                      : `${brief.audioRetentionDays} days`}
                  </dd>
                </div>
                <div><dt>Assistant</dt><dd>{brief.agentName}</dd></div>
              </dl>
            </section>
          </aside>
        </div>
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

function retentionLabel(days: number, deleteAfter: string | null) {
  if (days === 0) return "Deleted automatically after the final transcript is created.";
  if (deleteAfter) {
    return `Scheduled for deletion on ${new Date(deleteAfter).toLocaleDateString("en-GB")}.`;
  }
  return `Deleted automatically ${days} days after the final transcript is created.`;
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
