import { planReviewPayloadSchema, type CallCompilation, type CallTextArtifact } from "@callassist/contracts";

export function historyObjective(compilation: CallCompilation | null | undefined, artifacts: Pick<CallTextArtifact, "status" | "kind" | "sourceHash" | "targetLanguage" | "payload">[] = []) {
  if (!compilation) return { displayObjective: null, objectiveLanguage: null };
  if (compilation.displayObjective) return { displayObjective: compilation.displayObjective.text, objectiveLanguage: compilation.displayObjective.language };
  const language = compilation.compiledBrief?.sourceLanguage ?? "und";
  for (const artifact of artifacts) {
    if (artifact.kind !== "plan_review" || artifact.status !== "ready" || artifact.sourceHash !== compilation.snapshotHash ||
      artifact.targetLanguage.toLowerCase() !== language.toLowerCase()) continue;
    const payload = planReviewPayloadSchema.safeParse(artifact.payload);
    const text = payload.success ? payload.data.fields.find(field => field.id === "localizedObjective")?.text : null;
    if (text) return { displayObjective: text, objectiveLanguage: language };
  }
  return { displayObjective: compilation.rawBrief.objective, objectiveLanguage: language };
}
