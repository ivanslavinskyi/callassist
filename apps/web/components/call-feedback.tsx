"use client";

import type {
  CallGoalResult,
  CallBrief,
  CallOutcomeView,
  TranscriptQualityRating
} from "@callassist/contracts";
import { FormEvent, useEffect, useRef, useState } from "react";
import { getCallOutcome, submitCallFeedback } from "@/lib/api";
import { useUiLocale } from "./ui-locale-provider";
import { registrationCallMessages } from "@/lib/i18n/registration-call-messages";
import { CallAssessments } from "./call-assessments";

const goalResults: CallGoalResult[] = ["yes", "partly", "no"];
const transcriptRatings: TranscriptQualityRating[] = [
  "good",
  "some_errors",
  "poor"
];

export function CallFeedback({
  callId,
  brief,
  hasCompletedTranscript
}: {
  callId: string;
  brief: Pick<CallBrief, "status" | "lifecycle">;
  hasCompletedTranscript: boolean;
}) {
  const { locale, messages } = useUiLocale();
  const copy = messages.live;
  const extra = registrationCallMessages[locale];
  const [editing, setEditing] = useState(false);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<CallOutcomeView | null>(null);
  const [goalResult, setGoalResult] = useState<CallGoalResult | null>(null);
  const [transcriptQuality, setTranscriptQuality] = useState<
    TranscriptQualityRating | null
  >(null);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<
    "loading" | "idle" | "saving" | "saved" | "error"
  >("loading");
  const submissionKey = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setView(null); setEditing(false); submissionKey.current = null;
    void getCallOutcome(callId)
      .then((next) => {
        if (!active) return;
        setView(next);
        setGoalResult(next.latestFeedback?.goalResult ?? null);
        setTranscriptQuality(
          next.latestFeedback?.transcriptQuality ?? null
        );
        setComment(next.latestFeedback?.comment ?? "");
        setEditing(!next.latestFeedback);
        setStatus(next.latestFeedback ? "saved" : "idle");
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [callId, reload]);

  function changeAnswer(action: () => void) {
    submissionKey.current = null;
    if (status === "saved" || status === "error") setStatus("idle");
    action();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!view || !editing || !goalResult || status === "saving") return;
    submissionKey.current ??= crypto.randomUUID();
    setStatus("saving");
    try {
      const next = await submitCallFeedback(callId, {
        idempotencyKey: submissionKey.current,
        goalResult,
        transcriptQuality: hasCompletedTranscript
          ? transcriptQuality
          : null,
        comment: comment.trim() || null
      });
      setView(next);
      setEditing(false);
      setComment(next.latestFeedback?.comment ?? "");
      submissionKey.current = null;
      setStatus("saved");
      window.dispatchEvent(new Event("call-feedback-updated"));
    } catch {
      setStatus("error");
    }
  }

  if (brief.lifecycle?.answering && brief.lifecycle.answering.decision !== "consent" && !hasCompletedTranscript && !view?.latestFeedback) return null;
  return (
    <section id="call-feedback" className="call-feedback-card" aria-labelledby="call-feedback-title">
      <span className="eyebrow">{copy.feedbackEyebrow}</span>
      <h2 id="call-feedback-title">{copy.feedbackTitle}</h2>
      <p>{copy.feedbackHelp}</p>
      <CallAssessments brief={brief} locale={locale}
        feedback={view?.latestFeedback ? { ...view.latestFeedback, scope: view.feedbackScope ?? "call" } : null}
        feedbackState={!view && status === "loading" ? "loading" : !view ? "error" : "ready"} />

      {!view && status === "error" ? <div role="alert"><p>{extra.feedbackLoadingError}</p><button type="button" className="secondary-button" onClick={() => setReload(value => value + 1)}>{extra.reload}</button></div> : null}
      {!editing && view?.latestFeedback ? <div className="feedback-saved">
        <p role="status">{extra.feedbackSent}</p>
        {view.latestFeedback.comment ? <p className="feedback-saved-comment">{view.latestFeedback.comment}</p> : null}
        <button type="button" className="secondary-button" onClick={() => {
          setGoalResult(view.latestFeedback!.goalResult); setTranscriptQuality(view.latestFeedback!.transcriptQuality);
          setComment(view.latestFeedback!.comment ?? ""); submissionKey.current = null; setEditing(true); setStatus("idle");
        }}>{extra.editFeedback}</button>
      </div> : null}
      {editing && view ? <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={status === "loading" || status === "saving"}>
          <legend>{copy.feedbackGoalQuestion}</legend>
          <div className="feedback-options">
            {goalResults.map((value) => (
              <label
                className={goalResult === value ? "is-selected" : undefined}
                key={value}
              >
                <input
                  checked={goalResult === value}
                  name="goal-result"
                  onChange={() => changeAnswer(() => setGoalResult(value))}
                  type="radio"
                  value={value}
                />
                <span>{copy.feedbackGoal[value]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset
          disabled={
            !hasCompletedTranscript || status === "loading" || status === "saving"
          }
        >
          <legend>{copy.feedbackTranscriptQuestion}</legend>
          {hasCompletedTranscript ? (
            <div className="feedback-options">
              {transcriptRatings.map((value) => (
                <label
                  className={
                    transcriptQuality === value ? "is-selected" : undefined
                  }
                  key={value}
                >
                  <input
                    checked={transcriptQuality === value}
                    name="transcript-quality"
                    onChange={() =>
                      changeAnswer(() => setTranscriptQuality(value))
                    }
                    type="radio"
                    value={value}
                  />
                  <span>{copy.feedbackTranscriptQuality[value]}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="feedback-unavailable">
              {copy.feedbackTranscriptUnavailable}
            </p>
          )}
        </fieldset>

        <label className="feedback-comment">
          <span>{copy.feedbackCommentLabel}</span>
          <textarea
            disabled={status === "loading" || status === "saving"}
            maxLength={500}
            onChange={(event) =>
              changeAnswer(() => setComment(event.target.value))
            }
            placeholder={copy.feedbackCommentPlaceholder}
            rows={4}
            value={comment}
          />
          <small>
            {copy.feedbackCommentHint} {comment.length}/500
          </small>
        </label>

        <div className="feedback-submit-row">
          {view.latestFeedback ? <button type="button" className="secondary-button" disabled={status === "saving"} onClick={() => {
            setEditing(false); setStatus("saved"); submissionKey.current = null;
            setGoalResult(view.latestFeedback!.goalResult); setTranscriptQuality(view.latestFeedback!.transcriptQuality); setComment(view.latestFeedback!.comment ?? "");
          }}>{extra.cancel}</button> : null}
          <button
            className="primary-button"
            disabled={!goalResult || status === "loading" || status === "saving"}
            type="submit"
          >
            {status === "saving"
              ? copy.feedbackSaving
              : view?.latestFeedback
                ? extra.saveChanges
                : copy.feedbackSave}
          </button>
          <span
            aria-live="polite"
            className={status === "error" ? "feedback-error" : undefined}
          >
            {status === "saved"
              ? copy.feedbackSaved
              : status === "error"
                ? copy.feedbackError
                : ""}
          </span>
        </div>
      </form> : null}
    </section>
  );
}
