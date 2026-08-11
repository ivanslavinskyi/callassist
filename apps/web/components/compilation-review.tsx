"use client";

import {
  type CallCompilation,
  type ClarificationAnswer
} from "@callassist/contracts";
import { useState, type FormEvent } from "react";

export function CompilationReview({
  busy,
  compilation,
  onAnswerClarifications,
  onApproveAndCall,
  onEdit
}: {
  busy: boolean;
  compilation: CallCompilation;
  onAnswerClarifications: (answers: ClarificationAnswer[]) => Promise<void>;
  onApproveAndCall: () => void;
  onEdit: () => void;
}) {
  const compiled = compilation.compiledBrief;
  const decision = compilation.policyDecision;
  const blockingIssues = compiled?.blockingIssues ?? [];
  const isReady = decision.status === "ready_for_review";
  const stateLabel = isReady
    ? "Ready to call"
    : decision.status === "needs_clarification"
      ? "One detail is needed"
      : "This call needs changes";

  return (
    <section className={`compilation-review decision-${decision.status}`}>
      <div className="compilation-review-heading">
        <div>
          <span className="eyebrow">Call preview</span>
          <h2>{stateLabel}</h2>
        </div>
      </div>

      {compiled ? (
        <>
          <p className="call-plan-lead">{compiled.localizedObjective}</p>
          <div className="plan-setting-chips" aria-label="Conversation settings">
            <span>{toneLabels[compiled.tone]}</span>
            <span>{addressingLabels[compiled.addressingStyle ?? "formal"]}</span>
            <span>
              {resultHandlingLabels[
                compiled.resultHandling ?? "capture_in_callassist"
              ]}
            </span>
          </div>

          <div className="review-questions">
            <span>What the assistant will ask or say</span>
            <ol>
              {compiled.orderedQuestions.map((question, index) => (
                <li key={`${index}-${question.text}`}>{question.text}</li>
              ))}
            </ol>
          </div>
        </>
      ) : null}

      {decision.status === "needs_clarification" ? (
        <div className="clarification-panel">
          <strong>Add the missing detail here</strong>
          <p>
            Your existing brief will be updated. You will not need to fill it in
            again.
          </p>
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
          <strong>Why this cannot be called yet</strong>
          <ul>
            {decision.reasonCodes.map((code) => (
              <li key={code}>{policyReasonLabels[code]}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="review-actions">
        <button
          className="secondary-button"
          disabled={busy}
          onClick={onEdit}
          type="button"
        >
          Edit brief
        </button>
        {isReady ? (
          <button
            className="primary-button compact-button"
            disabled={busy}
            onClick={onApproveAndCall}
            type="button"
          >
            {busy ? "Starting..." : "Approve & call"}
          </button>
        ) : null}
      </div>

      <details className="technical-details">
        <summary>Technical details</summary>
        <div className="objective-comparison">
          <div>
            <span>Original objective</span>
            <p>{compilation.rawBrief.objective}</p>
          </div>
          <div>
            <span>Success means</span>
            <ul>
              {compiled?.successCriteria.map((criterion) => (
                <li key={criterion}>{criterion}</li>
              ))}
            </ul>
          </div>
        </div>

        {compiled ? (
          <div className="compiled-plan-grid">
            <div>
              <span>Product defaults used</span>
              <ul>
                {(compiled.assumptions ?? []).map((assumption) => (
                  <li key={assumption}>{assumptionLabels[assumption]}</li>
                ))}
              </ul>
            </div>
            <div>
              <span>Approved information</span>
              {compiled.approvedFacts.length > 0 ? (
                <ul>
                  {compiled.approvedFacts.map((fact) => (
                    <li key={fact.sourceText}>{fact.callLanguageText}</li>
                  ))}
                </ul>
              ) : (
                <p>None</p>
              )}
            </div>
            <div>
              <span>Guardrails</span>
              <ul>
                {compiled.prohibitedActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        <small className="compilation-meta">
          Revision {compilation.revision ?? 1} · Schema {compiled?.schemaVersion ?? "1"} ·
          Policy {decision.policyVersion} · Compiler {compilation.compilerModel} ·
          Snapshot {compilation.snapshotHash.slice(0, 12)}
        </small>
      </details>
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
        {busy ? "Updating..." : "Continue"}
      </button>
    </form>
  );
}

const toneLabels = {
  formal: "Formal tone",
  neutral: "Neutral tone",
  friendly: "Friendly tone"
} as const;

const addressingLabels = {
  formal: "Formal addressing",
  informal: "Informal addressing"
} as const;

const resultHandlingLabels = {
  capture_in_callassist: "Answers saved in CallAssist",
  request_external_delivery: "External delivery requested",
  message_only: "Message only"
} as const;

const assumptionLabels = {
  spoken_answers_saved_in_callassist: "Spoken answers are saved in CallAssist.",
  addressing_inferred: "Addressing is inferred from the relationship and recipient.",
  tone_inferred: "Tone is inferred from the relationship and purpose.",
  no_detailed_voicemail: "No call details are left on voicemail.",
  neutral_voicemail_only: "Only a neutral voicemail message may be left.",
  respect_refusal_and_end: "A refusal is respected and the call ends politely."
} as const;

const policyReasonLabels: Record<
  CallCompilation["policyDecision"]["reasonCodes"][number],
  string
> = {
  input_moderation_flagged: "The source brief was flagged by input moderation.",
  model_refusal: "The compiler refused to create an executable plan.",
  prohibited_content: "The brief contains a category outside the current low-risk scope.",
  material_ambiguity: "A legacy brief contains an unresolved material ambiguity.",
  required_information_missing: "Required information is missing.",
  fact_integrity_failure: "Approved information was not preserved exactly.",
  plan_constraint_failure: "The generated plan did not preserve a selected call option.",
  unsupported_task: "This task type is outside the current MVP scope."
};
