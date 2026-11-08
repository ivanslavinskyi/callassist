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
    if ("contextAppendix" in compiled) compiled.contextAppendix.forEach((section,index) => {
      for (const key of ["title","description","content"] as const) add(`contextAppendix.${index}.${key}`,section[key]);
    });
    if (compiled.schemaVersion === "9" && compiled.nativeAppointmentAuthorization) {
      const native = compiled.nativeAppointmentAuthorization;
      add("nativeAppointmentAuthorization.serviceDescription",native.serviceDescription);
      native.requirements.forEach((item,index)=>{ add(`nativeAppointmentAuthorization.requirements.${index}.description`,item.description); });
      native.alternatives.forEach((alternative,a)=>alternative.requirements.forEach((item,index)=>{ add(`nativeAppointmentAuthorization.alternatives.${a}.requirements.${index}.description`,item.description); }));
    }
    const authorization = getAppointmentAuthorization(compiled);
    if (authorization) add("appointmentAuthorization.serviceDescription", authorization.serviceDescription);
  }
  compilation.policyDecision.clarificationQuestions.forEach((text, index) => add(`policyDecision.clarificationQuestions.${index}`, text));
  return fields;
}
