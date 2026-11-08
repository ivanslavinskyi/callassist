import type { CallCompilation } from "./call-brief";

/** Compiler integrity failures belong to preparation, never to the user's language choice. */
export function isPlanPreparationFailure(decision: Pick<CallCompilation["policyDecision"], "status" | "reasonCodes"> & {issue?:{kind:string}}) {
  if(decision.status==="blocked"&&decision.issue)return decision.issue.kind==="plan_validation_failed";
  return decision.status === "blocked" && decision.reasonCodes.length > 0 &&
    decision.reasonCodes.every(reason => reason === "fact_integrity_failure" || reason === "plan_constraint_failure");
}
