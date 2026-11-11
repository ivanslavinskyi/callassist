import { taskOnlyCompiledCallBriefSchema } from "@callassist/contracts";

/** Provider fixture: the new transport keeps evidence next to its task item. */
export function inlineTaskModelOutput(plan: object) {
  const { taskEvidence, ...output } = taskOnlyCompiledCallBriefSchema.parse(plan);
  const sources = (path: string) => taskEvidence.find(entry => entry.path === path)?.sources ?? [];
  const criteria = (key: "successCriteria" | "unresolvedCriteria" | "stopConditions" | "prohibitedActions") =>
    output[key].map((text, index) => ({ text, sources: sources(`${key}.${index}`) }));
  return { ...output,
    successCriteria: criteria("successCriteria"), unresolvedCriteria: criteria("unresolvedCriteria"),
    stopConditions: criteria("stopConditions"), prohibitedActions: criteria("prohibitedActions"),
    conditionalFollowUps: output.conditionalFollowUps.map((item, index) => ({ ...item, sources: sources(`conditionalFollowUps.${index}.condition`) }))
  };
}
