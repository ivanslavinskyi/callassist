import type { CallCompilation } from "@callassist/contracts";

/** Integrity checks describe a failed preparation, not an invalid user request. */
export function isPlanPreparationFailure(decision: Pick<CallCompilation["policyDecision"], "status" | "reasonCodes">) {
  return decision.status === "blocked" && decision.reasonCodes.length > 0 &&
    decision.reasonCodes.every((reason) => reason === "fact_integrity_failure" || reason === "plan_constraint_failure");
}
