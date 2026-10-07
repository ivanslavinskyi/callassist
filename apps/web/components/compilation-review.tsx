"use client";

import {
  CALL_BRIEF_INPUT_LIMITS,
  answeringApproval,
  callBriefTaskTextLength,
  type CallCompilation,
  type ClarificationAnswer
} from "@callassist/contracts";
import { initialDisclosureMessages } from "@/lib/i18n/initial-disclosure-messages";
import { answeringMessages } from "@/lib/i18n/answering-messages";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ConfirmDialog } from "./confirm-dialog";
import { useUiLocale } from "./ui-locale-provider";
import { designMessages } from "@/lib/i18n/design-messages";
import { CallPlanPresentation } from "./call-plan-presentation";
import { isPlanPreparationFailure } from "@/lib/plan-preparation-failure";
import { approvalLayoutMessages } from "@/lib/i18n/approval-layout-messages";
import { appointmentMessages } from "@/lib/i18n/appointment-messages";

export function CompilationReview({
  busy,
  compilation,
  onAnswerClarifications,
  onApproveAndCall,
  onEdit,
  onRetryPreparation,
  recipientName,
  showActions = true,
  initialDisclosure,
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
  initialDisclosure?: { text: string; locale: string } | null;
  callDetails?: Array<{ label: string; value: string }>;
}) {
  const [confirmingCall, setConfirmingCall] = useState(false);
  const { locale, messages } = useUiLocale();
  const design = designMessages[locale];
  const copy = messages.review;
  const compiled = compilation.compiledBrief;
  const authorization = compiled && "appointmentAuthorization" in compiled ? compiled.appointmentAuthorization : null;
  const decision = compilation.policyDecision;
  const blockingIssues = compiled?.blockingIssues ?? [];
  const isReady = decision.status === "ready_for_review";
  const compactReview = isReady && showActions && !!compiled;
  const layout = approvalLayoutMessages[locale];
  const rootRef = useRef<HTMLElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!compactReview || !actionsRef.current || !rootRef.current) return;
    const root = rootRef.current;
    const actions = actionsRef.current;
    const documentRoot = document.documentElement;
    const previousPadding = documentRoot.style.scrollPaddingBottom;
    const previousClearance = documentRoot.style.getPropertyValue("--call-approval-clearance");
    const measure = () => {
      const height = Math.ceil(actions.getBoundingClientRect().height) + 24;
      const fixed = getComputedStyle(actions).position === "fixed";
      root.style.setProperty("--approval-actions-height", `${height}px`);
      documentRoot.style.setProperty("--call-approval-clearance", fixed ? `${height}px` : previousClearance || "0px");
      documentRoot.style.scrollPaddingBottom = fixed ? `calc(${height}px + var(--privacy-notice-clearance, 0px))` : previousPadding;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(actions);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect(); window.removeEventListener("resize", measure);
      documentRoot.style.scrollPaddingBottom = previousPadding;
      if (previousClearance) documentRoot.style.setProperty("--call-approval-clearance", previousClearance);
      else documentRoot.style.removeProperty("--call-approval-clearance");
    };
  }, [compactReview]);
  const preparationFailed = isPlanPreparationFailure(decision);
  const stateLabel = preparationFailed ? copy.preparationFailed : isReady
    ? copy.ready
    : decision.status === "needs_clarification"
      ? copy.clarificationNeeded
      : copy.changesNeeded;

  return (
    <section ref={rootRef} className={`compilation-review decision-${decision.status}`} data-actions={showActions} data-compact-review={compactReview}>
      <div className="review-plan">
      <div className="compilation-review-heading">
        <div>
          <span className="eyebrow">{copy.preview}</span>
          <h2>{compactReview ? layout.ready : preparationFailed || (showActions && !isReady) ? stateLabel : copy.whatWillDo}</h2>
        </div>
      </div>

      {compactReview ? <section className="review-overview">
        <p className="review-next-step">{layout.help}</p>
        <p className="call-plan-lead">{compiled.localizedObjective}</p>
        <dl className="review-contact">{callDetails.slice(0, 3).map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
        {compiled.prohibitedActions.length ? <div className="review-key-limits"><h3>{copy.guardrails}</h3><ul>{compiled.prohibitedActions.map(action => <li key={action}>{action}</li>)}</ul></div> : null}
        {authorization ? <div className="review-key-limits"><h3>{appointmentMessages[locale].title}</h3>
          <p>{authorization.serviceDescription} · {authorization.timeZone}</p>
          <ul>{authorization.windows.map((window, index) => <li key={index}>{window.date} · {window.startTime}–{window.endTime}</li>)}</ul>
          <p>{appointmentMessages[locale].financialPolicy}</p>
        </div> : null}
      </section> : null}

      <details className="review-full-plan" open={compactReview ? undefined : true} key={`${compilation.snapshotHash}:${compactReview}`}>
      <summary hidden={!compactReview}>{layout.details}</summary>
      {compiled && !preparationFailed ? <section className="initial-disclosure-preview">
        <h3>{initialDisclosureMessages[locale].title}</h3>
        {initialDisclosure ? <blockquote lang={initialDisclosure.locale}>{initialDisclosure.text}</blockquote>
          : <p>{initialDisclosureMessages[locale].unavailable}</p>}
      </section> : null}
      {compiled && !preparationFailed ? <CallPlanPresentation plan={compiled} uiLocale={locale} /> : null}

      {compiled && isReady && showActions ? <section>
        <h3>{answeringMessages[locale].policy}</h3>
        <p>{answeringMessages[locale].earlyDisclosure}</p>
        <p>{compiled.voicemailAction === "hang_up" ? answeringMessages[locale].silent : answeringMessages[locale].neutral}</p>
        {compiled.voicemailAction === "leave_neutral_message" ? <blockquote lang={compiled.callLocale}>
          {answeringApproval(compiled.voicemailAction, compiled.callLocale).message}
        </blockquote> : null}
        <p className="muted-text">{answeringMessages[locale].uncertainty}</p>
      </section> : null}
      </details>

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
        {(compactReview ? callDetails.slice(3) : callDetails).length ? <section><h2>{design.callDetails}</h2><dl>{(compactReview ? callDetails.slice(3) : callDetails).map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl></section> : null}
        <section className="review-approval"><h2>{preparationFailed ? copy.retryPreparation : design.yourApproval}</h2>
        {!preparationFailed ? <p>{design.approvalHelp}</p> : null}
        <div ref={actionsRef} className="review-actions" role="group" aria-label={design.yourApproval}>
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
        <button className="secondary-button" disabled={busy} onClick={onEdit} type="button">{copy.edit}</button>
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
