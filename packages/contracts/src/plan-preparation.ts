import type { CallCompilation } from "./call-brief";

/** Compiler integrity failures belong to preparation, never to the user's language choice. */
export function isPlanPreparationFailure(decision: Pick<CallCompilation["policyDecision"], "status" | "reasonCodes">) {
  return decision.status === "blocked" && decision.reasonCodes.length > 0 &&
    decision.reasonCodes.every(reason => reason === "fact_integrity_failure" || reason === "plan_constraint_failure");
}
