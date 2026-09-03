"use client";

import {
  type CallCompilation,
  type ClarificationAnswer
} from "@callassist/contracts";
import { useState, type FormEvent } from "react";
import { ConfirmDialog } from "./confirm-dialog";
import { useUiLocale } from "./ui-locale-provider";

export function CompilationReview({
  busy,
  compilation,
  onAnswerClarifications,
  onApproveAndCall,
  onEdit,
  recipientName,
  showActions = true
}: {
  busy: boolean;
  compilation: CallCompilation;
  onAnswerClarifications: (answers: ClarificationAnswer[]) => Promise<void>;
  onApproveAndCall: () => void;
  onEdit: () => void;
  recipientName: string;
  showActions?: boolean;
}) {
  const [confirmingCall, setConfirmingCall] = useState(false);
  const { messages } = useUiLocale();
  const copy = messages.review;
  const compiled = compilation.compiledBrief;
  const decision = compilation.policyDecision;
  const blockingIssues = compiled?.blockingIssues ?? [];
  const isReady = decision.status === "ready_for_review";
  const stateLabel = isReady
    ? copy.ready
    : decision.status === "needs_clarification"
      ? copy.clarificationNeeded
      : copy.changesNeeded;

  return (
    <section className={`compilation-review decision-${decision.status}`}>
      <div className="compilation-review-heading">
        <div>
          <span className="eyebrow">{copy.preview}</span>
          <h2>{stateLabel}</h2>
        </div>
      </div>

      {compiled ? (
        <>
          <p className="call-plan-lead">{compiled.localizedObjective}</p>
          <div className="review-questions">
            <span>{copy.whatWillDo}</span>
            <ul>
              {compiled.successCriteria.map((criterion) => (
                <li key={criterion}>{criterion}</li>
              ))}
            </ul>
          </div>

          <div className="review-questions">
            <span>{copy.callSettings}</span>
          </div>
          <div className="plan-setting-chips" aria-label={copy.callSettings}>
            <span>{copy.tone[compiled.tone]}</span>
            <span>{copy.addressing[compiled.addressingStyle ?? "formal"]}</span>
            <span>
              {copy.result[
                compiled.resultHandling ?? "capture_in_callassist"
              ]}
            </span>
          </div>

          {compiled.opening ? (
            <div className="review-opening">
              <span>{copy.opening}</span>
              <p>
                {compiled.opening.recipientAddress}{" "}
                {compiled.opening.purposeStatement}{" "}
                {compiled.opening.readinessQuestion}
              </p>
            </div>
          ) : null}

          <div className="review-questions">
            <span>{copy.questions}</span>
            <ol>
              {compiled.orderedQuestions.map((question, index) => (
                <li key={`${index}-${question.text}`}>{question.text}</li>
              ))}
            </ol>
          </div>

          <div className="compiled-plan-grid">
            <div>
              <span>{copy.approvedInformation}</span>
              {compiled.approvedFacts.length > 0 ? (
                <ul>
                  {compiled.approvedFacts.map((fact) => (
                    <li key={fact.sourceText}>{fact.callLanguageText}</li>
                  ))}
                </ul>
              ) : <p>{copy.none}</p>}
            </div>
            <div>
              <span>{copy.guardrails}</span>
              <ul>
                {compiled.prohibitedActions.map((action) => <li key={action}>{action}</li>)}
              </ul>
            </div>
          </div>
        </>
      ) : null}

      {decision.status === "needs_clarification" ? (
        <div className="clarification-panel">
          <strong>{copy.addMissingDetail}</strong>
          <p>{copy.clarificationHelp}</p>
          {blockingIssues.length > 0 ? (
            <ClarificationForm
              busy={busy}
              issues={blockingIssues}
              onSubmit={onAnswerClarifications}
            />
          ) : (
            <ul>
              {decision.clarificationQuestions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {decision.status === "blocked" ? (
        <div className="policy-reasons">
          <strong>{copy.blockedReason}</strong>
          <ul>
            {decision.reasonCodes.map((code) => (
              <li key={code}>{copy.reason[code]}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {showActions ? <div className="review-actions">
        <button
          className="secondary-button"
          disabled={busy}
          onClick={onEdit}
          type="button"
        >
          {copy.edit}
        </button>
        {isReady ? (
          <button
            className="primary-button compact-button"
            disabled={busy}
            onClick={() => setConfirmingCall(true)}
            type="button"
          >
            {busy ? copy.starting : copy.approveAndCall}
          </button>
        ) : null}
      </div> : null}

      <ConfirmDialog
        busy={busy}
        confirmLabel={messages.call.approveConfirm}
        description={messages.call.approveBody(recipientName)}
        onCancel={() => setConfirmingCall(false)}
        onConfirm={() => {
          setConfirmingCall(false);
          onApproveAndCall();
        }}
        open={confirmingCall}
        title={messages.call.approveTitle}
      />

    </section>
  );
}
function ClarificationForm({
  busy,
  issues,
  onSubmit
}: {
  busy: boolean;
  issues: NonNullable<CallCompilation["compiledBrief"]>["blockingIssues"];
  onSubmit: (answers: ClarificationAnswer[]) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const { messages } = useUiLocale();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSubmit(
      issues.map(({ code }) => ({
        issueCode: code,
        answer: answers[code]!.trim()
      }))
    );
  }

  const complete = issues.every(({ code }) => answers[code]?.trim());
  return (
    <form className="clarification-form" onSubmit={handleSubmit}>
      {issues.map(({ code, question }) => (
        <label className="field" key={code}>
          <span>{question}</span>
          <textarea
            onChange={(event) =>
              setAnswers((current) => ({
                ...current,
                [code]: event.target.value
              }))
            }
            rows={2}
            value={answers[code] ?? ""}
          />
        </label>
      ))}
      <button
        className="primary-button compact-button"
        disabled={busy || !complete}
        type="submit"
      >
        {busy ? messages.review.updating : messages.review.continue}
      </button>
    </form>
  );
}
