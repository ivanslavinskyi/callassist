import { describe, expect, it } from "vitest";
import { emptyCallStageCounts } from "@callassist/contracts";
import { historyFilterOptions, readCallHistoryFilter, showHistoryFilter } from "./call-history-filter";

describe("history filter availability", () => {
  it("hides an unselected filter when all matches have one state", () => {
    const counts = { ...emptyCallStageCounts(), ended: 80 };
    expect(showHistoryFilter(counts, false)).toBe(false);
    expect(historyFilterOptions(counts)).toEqual(["ended"]);
    expect(showHistoryFilter(emptyCallStageCounts(), false)).toBe(false);
  });
  it("keeps a selected zero-count option and the control visible", () => {
    const counts = { ...emptyCallStageCounts(), review_required: 2 };
    expect(historyFilterOptions(counts, "ended")).toEqual(["review_required", "ended"]);
    expect(showHistoryFilter(counts, true)).toBe(true);
    expect(historyFilterOptions(emptyCallStageCounts(), "ended")).toEqual(["ended"]);
  });
  it("does not offer demo approvals but can still filter other existing states", () => {
    const counts = { ...emptyCallStageCounts(), awaiting_approval: 2, ended: 4 };
    expect(historyFilterOptions(counts)).toEqual(["ended"]);
    expect(showHistoryFilter(counts, false)).toBe(true);
  });
  it("preserves exact legacy links and gives a valid new filter precedence", () => {
    expect(readCallHistoryFilter(new URLSearchParams("status=failed"))).toEqual({ stage: undefined, status: "failed" });
    expect(readCallHistoryFilter(new URLSearchParams("status=awaiting_approval"))).toEqual({ stage: undefined, status: "awaiting_approval" });
    expect(readCallHistoryFilter(new URLSearchParams("stage=ended&status=failed"))).toEqual({ stage: "ended", status: undefined });
    expect(readCallHistoryFilter(new URLSearchParams("stage=awaiting_approval"))).toEqual({ stage: undefined, status: undefined });
  });
});
