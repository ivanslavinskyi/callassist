import type { CompiledCallBrief } from "@callassist/contracts";
import { messages, type UiLocale } from "@/lib/i18n/messages";

/** Display-only projection: deliberately has no IDs, approval state or actions. */
export type CallPlanPresentationData = Pick<CompiledCallBrief,
  "localizedObjective" | "successCriteria" | "tone" | "addressingStyle" |
  "resultHandling" | "opening" | "orderedQuestions" | "approvedFacts" |
  "prohibitedActions"
>;

export function CallPlanPresentation({ plan, uiLocale, headingLevel = 2 }: {
  plan: CallPlanPresentationData;
  uiLocale: UiLocale;
  headingLevel?: 2 | 4;
}) {
  const copy = messages[uiLocale].review;
  const Heading = headingLevel === 4 ? "h4" : "h2";
  return <>
    <p className="call-plan-lead">{plan.localizedObjective}</p>
    <div className="review-questions review-success-criteria">
      <ul>{plan.successCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul>
    </div>
    <div className="review-questions"><Heading>{copy.callSettings}</Heading></div>
    <div className="plan-setting-chips" aria-label={copy.callSettings}>
      <span>{copy.tone[plan.tone]}</span>
      <span>{copy.addressing[plan.addressingStyle]}</span>
      <span>{copy.result[plan.resultHandling]}</span>
    </div>
    <div className="review-opening">
      <Heading>{copy.opening}</Heading>
      <p>{plan.opening.recipientAddress} {plan.opening.purposeStatement} {plan.opening.readinessQuestion}</p>
    </div>
    <div className="review-questions">
      <Heading>{copy.questions}</Heading>
      <ol>{plan.orderedQuestions.map((question, index) => <li key={index}>{question.text}</li>)}</ol>
    </div>
    <div className="compiled-plan-grid">
      <div>
        <Heading>{copy.approvedInformation}</Heading>
        {plan.approvedFacts.length ? <ul>{plan.approvedFacts.map((fact, index) =>
          <li key={index}>{fact.callLanguageText}</li>
        )}</ul> : <p>{copy.none}</p>}
      </div>
      <div>
        <Heading>{copy.guardrails}</Heading>
        <ul>{plan.prohibitedActions.map((action) => <li key={action}>{action}</li>)}</ul>
      </div>
    </div>
  </>;
}
