import { expect, it } from "vitest";
import { approvedCall, authorization } from "./voice-test-helpers";
import { selectNativeSession } from "./live-native-prompts";

const parties = { representedPerson: "Nina Keller", recipientName: "Example AG" };
it("preserves the full approved data deterministically and refuses an oversized brief", async () => {
  const h = await approvedCall();
  try {
    const selected = selectNativeSession(true, h.snapshot, parties, true);
    expect(selected.reason).toBe("eligible");
    expect(selected).toEqual(selectNativeSession(true, h.snapshot, parties, true));
    const brief = JSON.stringify(selected.session!.input);
    expect(brief).toContain(h.snapshot.plan.localizedObjective);
    expect(brief).toContain(h.snapshot.plan.approvedFacts[0]);
    expect(selected.session!.briefHash).toMatch(/^[a-f0-9]{64}$/);
    const oversized = structuredClone(h.snapshot);
    oversized.plan.backgroundSummary = "я".repeat(4_000);
    expect(selectNativeSession(true, oversized, parties, true)).toEqual({ reason: "brief_budget", session: null });
    expect(selectNativeSession(false, h.snapshot, parties, true).reason).toBe("disabled");
    expect(selectNativeSession(true, h.snapshot, parties, false).reason).toBe("hangup_disabled");
  } finally { await h.service.close(); }
});
it("does not admit appointment authority even under an informational task label", async () => {
  const h = await approvedCall(authorization);
  try {
    const mislabeled = structuredClone(h.snapshot);
    mislabeled.plan.taskType = "information_request";
    expect(selectNativeSession(true, mislabeled, parties, true).reason).toBe("protected_action");
  } finally { await h.service.close(); }
});
