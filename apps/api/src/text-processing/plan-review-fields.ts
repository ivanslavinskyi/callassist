import { getAppointmentAuthorization, type CallCompilation } from "@callassist/contracts";

/** Execution controls, source facts, IDs and policy codes are never rewritten by translation. */
export function planReviewFields(compilation: CallCompilation) {
  const fields: Array<{ id: string; text: string }> = [];
  const add = (id: string, text: string) => { if (text.trim()) fields.push({ id, text }); };
  const compiled = compilation.compiledBrief;
  if (compiled) {
    add("localizedObjective", compiled.localizedObjective);
    add("backgroundSummary", compiled.backgroundSummary);
    for (const key of ["recipientAddress", "purposeStatement", "readinessQuestion"] as const) add(`opening.${key}`, compiled.opening[key]);
    compiled.orderedQuestions.forEach((question, index) => {
      for (const key of ["text", "purpose"] as const) add(`orderedQuestions.${index}.${key}`, question[key]);
    });
    compiled.conditionalFollowUps.forEach((question, index) => {
      for (const key of ["condition", "question"] as const) add(`conditionalFollowUps.${index}.${key}`, question[key]);
    });
    for (const key of ["successCriteria", "unresolvedCriteria", "stopConditions", "prohibitedActions"] as const) {
      compiled[key].forEach((text, index) => add(`${key}.${index}`, text));
    }
    compiled.approvedFacts.forEach((fact, index) => add(`approvedFacts.${index}.callLanguageText`, fact.callLanguageText));
    compiled.blockingIssues.forEach((issue, index) => add(`blockingIssues.${index}.question`, issue.question));
    const authorization = getAppointmentAuthorization(compiled);
    if (authorization) add("appointmentAuthorization.serviceDescription", authorization.serviceDescription);
  }
  compilation.policyDecision.clarificationQuestions.forEach((text, index) => add(`policyDecision.clarificationQuestions.${index}`, text));
  return fields;
}
