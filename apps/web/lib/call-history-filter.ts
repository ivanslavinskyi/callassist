import { callBriefStatusSchema, callHistoryStageSchema, type CallHistoryStage, type CallStage } from "@callassist/contracts";

export function readCallHistoryFilter(params: Pick<URLSearchParams, "get">) {
  const stage = callHistoryStageSchema.options.find(value => value === params.get("stage"));
  const status = stage ? undefined : callBriefStatusSchema.options.find(value => value === params.get("status"));
  return { stage, status };
}
export function historyFilterOptions(counts: Record<CallStage, number>, selected?: CallHistoryStage) {
  return callHistoryStageSchema.options.filter(stage => counts[stage] > 0 || stage === selected);
}
export function showHistoryFilter(counts: Record<CallStage, number>, selected: boolean) {
  // Count demo-only records in the diversity check, but never offer that state.
  return selected || Object.values(counts).filter(count => count > 0).length > 1;
}
