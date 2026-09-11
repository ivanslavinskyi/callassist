"use client";

import {
  CALL_BRIEF_INPUT_LIMITS,
  callBriefTaskTextLength,
  type CallCompilation,
  type ClarificationAnswer
} from "@callassist/contracts";
import { useState, type FormEvent } from "react";
import { ConfirmDialog } from "./confirm-dialog";
import { useUiLocale } from "./ui-locale-provider";
import { designMessages } from "@/lib/i18n/design-messages";
import { CallPlanPresentation } from "./call-plan-presentation";
import { isPlanPreparationFailure } from "@/lib/plan-preparation-failure";

export function CompilationReview({
  busy,
  compilation,
  onAnswerClarifications,
  onApproveAndCall,
  onEdit,
  onRetryPreparation,
  recipientName,
  showActions = true,
  callDetails = []
}: {
  busy: boolean;
  compilation: CallCompilation;
  onAnswerClarifications: (answers: ClarificationAnswer[]) => Promise<void>;
  onApproveAndCall: () => void;
  onEdit: () => void;
  onRetryPreparation?: () => void;
  recipientName: string;
  showActions?: boolean;
  callDetails?: Array<{ label: string; value: string }>;
}) {
  const [confirmingCall, setConfirmingCall] = useState(false);
  const { locale, messages } = useUiLocale();
  const design = designMessages[locale];
  const copy = messages.review;
  const compiled = compilation.compiledBrief;
  const decision = compilation.policyDecision;
  const blockingIssues = compiled?.blockingIssues ?? [];
  const isReady = decision.status === "ready_for_review";
  const preparationFailed = isPlanPreparationFailure(decision);
  const stateLabel = preparationFailed ? copy.preparationFailed : isReady
    ? copy.ready
    : decision.status === "needs_clarification"
      ? copy.clarificationNeeded
      : copy.changesNeeded;

  return (
    <section className={`compilation-review decision-${decision.status}`} data-actions={showActions}>
      <div className="review-plan">
      <div className="compilation-review-heading">
        <div>
          <span className="eyebrow">{copy.preview}</span>
          <h2>{preparationFailed || (showActions && !isReady) ? stateLabel : copy.whatWillDo}</h2>
        </div>
      </div>

      {compiled && !preparationFailed ? <CallPlanPresentation plan={compiled} uiLocale={locale} /> : null}

      {decision.status === "needs_clarification" ? (
        <div className="clarification-panel">
          <strong>{copy.addMissingDetail}</strong>
          <p>{copy.clarificationHelp}</p>
          {blockingIssues.length > 0 ? (
            <ClarificationForm
              baseBrief={compilation.rawBrief}
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
          {preparationFailed ? <p role="alert">{copy.preparationFailedHelp}</p> : <>
          <strong>{copy.blockedReason}</strong>
          <ul>
            {decision.reasonCodes.map((code) => (
              <li key={code}>{copy.reason[code]}</li>
            ))}
          </ul>
          </>}
        </div>
      ) : null}

      </div>
      {showActions ? <aside className="review-sidebar">
        {callDetails.length ? <section><h2>{design.callDetails}</h2><dl>{callDetails.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl></section> : null}
        <section><h2>{preparationFailed ? copy.retryPreparation : design.yourApproval}</h2>
        {!preparationFailed ? <p>{design.approvalHelp}</p> : null}
        <div className="review-actions">
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
        {preparationFailed && onRetryPreparation ? <button className="primary-button compact-button"
          disabled={busy} onClick={onRetryPreparation} type="button">
          {busy ? copy.retryingPreparation : copy.retryPreparation}
        </button> : null}
        </div></section>
      </aside> : null}

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
  baseBrief,
  busy,
  issues,
  onSubmit
}: {
  baseBrief: CallCompilation["rawBrief"];
  busy: boolean;
  issues: NonNullable<CallCompilation["compiledBrief"]>["blockingIssues"];
  onSubmit: (answers: ClarificationAnswer[]) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const { messages } = useUiLocale();
  const issueCodes = new Set(issues.map(({ code }) => code));
  const draftAnswers = issues.map(({ code }) => ({
    issueCode: code,
    answer: answers[code] ?? ""
  }));
  const taskTextLength = callBriefTaskTextLength({
    ...baseBrief,
    clarificationAnswers: [
      ...baseBrief.clarificationAnswers.filter(({ issueCode }) =>
        !issueCodes.has(issueCode)
      ),
      ...draftAnswers
    ]
  });
  const taskTextOverLimit =
    taskTextLength > CALL_BRIEF_INPUT_LIMITS.aggregateTaskTextHard;

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
            maxLength={CALL_BRIEF_INPUT_LIMITS.clarificationAnswer}
            rows={2}
            value={answers[code] ?? ""}
          />
        </label>
      ))}
      <p className={taskTextOverLimit ? "field-invalid" : undefined}>
        {messages.form.taskTextBudget(
          taskTextLength,
          CALL_BRIEF_INPUT_LIMITS.aggregateTaskTextHard
        )}
      </p>
      <button
        className="primary-button compact-button"
        disabled={busy || !complete || taskTextOverLimit}
        type="submit"
      >
        {busy ? messages.review.updating : messages.review.continue}
      </button>
    </form>
  );
}
