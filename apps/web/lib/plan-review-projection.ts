import { planReviewPayloadSchema, type CallCompilation, type CallTextArtifact, type PlanSource, type TextLanguage } from "@callassist/contracts";

/** A failed newer generator must not hide a validated saved reader for the same source. */
export function currentPlanReviewArtifact(items: CallTextArtifact[], compilation: CallCompilation, source: PlanSource,
  targetLanguage: TextLanguage, kind: "plan_review" | "clarification_review") {
  const candidates = items.filter((item) => item.kind === kind && item.compilationId === source.compilationId &&
    item.sourceHash === source.snapshotHash && item.targetLanguage === targetLanguage)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return candidates.find((item) => projectPlanReview(compilation, source, item) !== null) ?? candidates[0];
}

/** Only text leaves can change. IDs, codes, policy, scope and source facts remain authoritative. */
export function projectPlanReview(compilation: CallCompilation, source: PlanSource, artifact: CallTextArtifact): CallCompilation | null {
  if (artifact.status !== "ready" || !artifact.payloadHash || artifact.compilationId !== source.compilationId || artifact.sourceHash !== source.snapshotHash ||
    !["plan_review", "clarification_review"].includes(artifact.kind)) return null;
  const parsed = planReviewPayloadSchema.safeParse(artifact.payload);
  if (!parsed.success) return null;
  const projected = structuredClone(compilation);
  const compiled = projected.compiledBrief;
  const setters = new Map<string, (text: string) => void>();
  const add = (id: string, value: string, assign: (text: string) => void) => {
    if (value.trim()) setters.set(id, assign);
  };
  if (compiled) {
    add("localizedObjective", compiled.localizedObjective, (text) => { compiled.localizedObjective = text; });
    add("backgroundSummary", compiled.backgroundSummary, (text) => { compiled.backgroundSummary = text; });
    for (const key of ["recipientAddress", "purposeStatement", "readinessQuestion"] as const) {
      add(`opening.${key}`, compiled.opening[key], (text) => { compiled.opening[key] = text; });
    }
    compiled.orderedQuestions.forEach((question, index) => {
      for (const key of ["text", "purpose"] as const) add(`orderedQuestions.${index}.${key}`, question[key], (text) => { question[key] = text; });
    });
    compiled.conditionalFollowUps.forEach((question, index) => {
      for (const key of ["condition", "question"] as const) add(`conditionalFollowUps.${index}.${key}`, question[key], (text) => { question[key] = text; });
    });
    for (const key of ["successCriteria", "unresolvedCriteria", "stopConditions", "prohibitedActions"] as const) {
      compiled[key].forEach((value, index) => add(`${key}.${index}`, value, (text) => { compiled[key][index] = text; }));
    }
    compiled.approvedFacts.forEach((fact, index) => add(`approvedFacts.${index}.callLanguageText`, fact.callLanguageText, (text) => { fact.callLanguageText = text; }));
    compiled.blockingIssues.forEach((issue, index) => add(`blockingIssues.${index}.question`, issue.question, (text) => { issue.question = text; }));
  }
  projected.policyDecision.clarificationQuestions.forEach((question, index) => add(`policyDecision.clarificationQuestions.${index}`, question, (text) => {
    projected.policyDecision.clarificationQuestions[index] = text;
  }));
  const seen = new Set<string>();
  for (const field of parsed.data.fields) {
    const assign = setters.get(field.id);
    if (!assign || seen.has(field.id)) return null;
    seen.add(field.id);
    assign(field.text);
  }
  // Never present a partial projection as a completely translated approved plan.
  return seen.size === setters.size ? projected : null;
}
