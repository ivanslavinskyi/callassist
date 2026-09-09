import { supportedTextLanguage, type CallCompilation, type CallLanguageContext } from "@callassist/contracts";

type ReviewCompilation = {
  rawBrief: Pick<CallCompilation["rawBrief"], "locale">;
  compiledBrief: Pick<NonNullable<CallCompilation["compiledBrief"]>, "sourceLanguage" | "blockingIssues"> | null;
  policyDecision: Pick<CallCompilation["policyDecision"], "status" | "clarificationQuestions">;
};

/** Clarifications originate in the objective language; the rest of the plan uses the call language. */
export function planReviewLanguage(compilation: ReviewCompilation,
  context: Pick<CallLanguageContext, "taskContentLanguage" | "detectedInputLanguage">) {
  const kind = compilation.compiledBrief && compilation.policyDecision.status === "ready_for_review"
    ? "plan_review" as const : "clarification_review" as const;
  const source = supportedTextLanguage(compilation.compiledBrief?.sourceLanguage ?? context.detectedInputLanguage);
  const hasClarifications = compilation.policyDecision.status === "needs_clarification" ||
    compilation.policyDecision.clarificationQuestions.length > 0 || Boolean(compilation.compiledBrief?.blockingIssues.length);
  return {
    kind,
    sourceLanguage: kind === "plan_review" ? compilation.rawBrief.locale : source ?? "*",
    needsTranslation: supportedTextLanguage(compilation.rawBrief.locale) !== context.taskContentLanguage ||
      (hasClarifications && source !== context.taskContentLanguage)
  };
}
