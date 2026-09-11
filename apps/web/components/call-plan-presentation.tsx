import type { AppointmentAuthorization, CompiledCallBrief } from "@callassist/contracts";
import { messages, type UiLocale } from "@/lib/i18n/messages";
import { appointmentMessages } from "@/lib/i18n/appointment-messages";

/** Display-only projection: deliberately has no IDs, approval state or actions. */
export type CallPlanPresentationData = Pick<CompiledCallBrief,
  "localizedObjective" | "successCriteria" | "tone" | "addressingStyle" |
  "resultHandling" | "opening" | "orderedQuestions" | "approvedFacts" |
  "prohibitedActions"
> & { appointmentAuthorization?: AppointmentAuthorization | null };

export function CallPlanPresentation({ plan, uiLocale, headingLevel = 2 }: {
  plan: CallPlanPresentationData;
  uiLocale: UiLocale;
  headingLevel?: 2 | 4;
}) {
  const copy = messages[uiLocale].review;
  const appointmentCopy = appointmentMessages[uiLocale];
  const authorization = plan.appointmentAuthorization;
  const Heading = headingLevel === 4 ? "h4" : "h2";
  return <>
    <p className="call-plan-lead">{plan.localizedObjective}</p>
    <div className="review-questions review-success-criteria">
      <ul>{plan.successCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul>
    </div>
    {authorization ? <section className="review-questions appointment-authorization" aria-label={appointmentCopy.title}>
      <Heading>{appointmentCopy.title}</Heading>
      <p><strong>{appointmentCopy.operation[authorization.operation]}</strong>: {authorization.serviceDescription}</p>
      <p>{appointmentCopy.scope}</p>
      <dl className="appointment-time-zone"><dt>{appointmentCopy.timeZone}</dt><dd>{authorization.timeZone}</dd></dl>
      <p className="appointment-window-label">{appointmentCopy.windows}</p>
      <ul className="appointment-windows">{authorization.windows.map((window, index) => <li key={`${window.date}:${window.startTime}:${window.endTime}:${index}`}>
        <time dateTime={window.date}>{window.date}</time>
        <span>{window.startTime === window.endTime ? window.startTime : `${window.startTime}–${window.endTime}`}</span>
      </li>)}</ul>
      {authorization.windows.some((window) => window.startTime !== window.endTime) ? <p className="appointment-window-note">{appointmentCopy.inclusive}</p> : null}
      <ul className="appointment-limits"><li>{appointmentCopy.selection[authorization.operation]}</li><li>{appointmentCopy.financialPolicy}</li></ul>
    </section> : null}
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
