import type { CallCompilation, SourceSegment } from "@callassist/contracts";
import type { TextProcessingInput } from "./text-processor";

/** Post-call checks are independent of what the assistant needs to ask aloud. */
export function summaryInput(compilation: CallCompilation, segments: SourceSegment[], targetLanguage: Extract<TextProcessingInput, { kind: "call_summary" }>["targetLanguage"]): Extract<TextProcessingInput, { kind: "call_summary" }> {
  const plan = compilation.compiledBrief;
  if (!plan) throw new Error("SUMMARY_PLAN_MISSING");
  return {
    kind: "call_summary", targetLanguage, segments,
    context: { objective: plan.localizedObjective, taskType: plan.taskType,
      recipient: compilation.rawBrief.recipientName, representedPerson: compilation.rawBrief.representedPerson },
    checks: [
      { id: "goal", text: plan.localizedObjective },
      ...plan.successCriteria.map((text, index) => ({ id: `criterion.${index}`, text })),
      ...plan.orderedQuestions.map((question, index) => ({ id: `question.${index}`, text: question.text }))
    ]
  };
}
