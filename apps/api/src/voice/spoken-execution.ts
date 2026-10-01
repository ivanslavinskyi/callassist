import { createSpokenIdentities, projectSpokenIdentityText, type ApprovedExecutionSnapshot, type SpokenIdentities } from "@callassist/contracts";
import type { LiveExecutionParties } from "./live-managed-tools";

export function executionSpokenIdentities(snapshot: ApprovedExecutionSnapshot, parties?: LiveExecutionParties) {
  return snapshot.runtime.spokenIdentities ?? createSpokenIdentities(snapshot.plan.callLocale,
    parties?.recipientName ?? "", parties?.representedPerson ?? "");
}

/** Speech view only. The frozen approval and action authorization retain original spelling. */
export function spokenExecutionPlan(snapshot: ApprovedExecutionSnapshot, identities: SpokenIdentities) {
  const plan = snapshot.plan;
  const text = (value: string) => projectSpokenIdentityText(value, identities);
  return { ...plan,
    localizedObjective: text(plan.localizedObjective),
    opening: { recipientAddress: text(plan.opening.recipientAddress), purposeStatement: text(plan.opening.purposeStatement),
      readinessQuestion: text(plan.opening.readinessQuestion) },
    backgroundSummary: text(plan.backgroundSummary),
    orderedQuestions: plan.orderedQuestions.map(q => ({ ...q, text: text(q.text), purpose: text(q.purpose) })),
    conditionalFollowUps: plan.conditionalFollowUps.map(q => ({ condition: text(q.condition), question: text(q.question) })),
    successCriteria: plan.successCriteria.map(text), unresolvedCriteria: plan.unresolvedCriteria.map(text),
    stopConditions: plan.stopConditions.map(text), approvedFacts: plan.approvedFacts.map(text), prohibitedActions: plan.prohibitedActions.map(text)
  };
}
