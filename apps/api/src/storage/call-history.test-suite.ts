import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { callHistoryListSchema, normalizeCreateCallBriefInput, type CallBriefStatus } from "@callassist/contracts";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { decodeCallBriefCursor, type CallRepository } from "./call-repository";

export function callHistorySuite(make: () => Promise<{ repository: CallRepository; owner: string; other: string }>) {
  const compiler = new DeterministicBriefCompiler();
  async function create(repository: CallRepository, owner: string, recipientName: string, status?: CallBriefStatus) {
    const input = normalizeCreateCallBriefInput({ recipientName, phoneNumber: "+41523686688", objective: "Ask when the office opens",
      assistantProfileId: "sebastian", representedPersonFirstName: "Nina", representedPersonLastName: "Example",
      locale: "en-GB", allowLanguageSwitch: false, allowedFacts: [] });
    const brief = await repository.create(input, await compiler.compile(input), owner);
    if (status) await repository.updateStatus(brief.id, status);
    return brief;
  }

  it("counts the entire search scope independently of stage, legacy status and cursor", async () => {
    const { repository: r, owner, other } = await make();
    for (const status of ["completed", "failed", "stopped", "completed", "review_required", "review_required", "awaiting_approval"] as const)
      await create(r, owner, `Clinic ${status}`, status);
    await create(r, owner, "Other office", "ready");
    await create(r, other, "Clinic private", "ready");
    const first = callHistoryListSchema.parse(await r.list({ userId: owner, search: "Clinic", stage: "ended", limit: 2 }));
    expect(first.items).toHaveLength(2);
    expect(first.stageCounts).toMatchObject({ ended: 4, review_required: 2, awaiting_approval: 1, ready: 0 });
    expect(first.nextCursor).not.toBeNull();
    const second = await r.list({ userId: owner, search: "Clinic", stage: "ended", limit: 2, cursor: decodeCallBriefCursor(first.nextCursor!)! });
    expect(second.items).toHaveLength(2);
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(4);
    expect(second.stageCounts).toEqual(first.stageCounts);
    expect(second.nextCursor).toBeNull();
    const legacy = await r.list({ userId: owner, search: "Clinic", status: "completed", limit: 1 });
    expect(legacy.legacyStatusCount).toBe(2);
    expect(legacy.stageCounts).toEqual(first.stageCounts);
    expect(legacy.items.every(item => item.status === "completed")).toBe(true);
    const empty = await r.list({ userId: owner, search: "Other", stage: "ended", limit: 20 });
    expect(empty.items).toEqual([]);
    expect(empty.stageCounts).toMatchObject({ ready: 1, ended: 0 });
    expect((await r.list({ userId: other, search: "Clinic", limit: 20 })).stageCounts).toMatchObject({ ready: 1, ended: 0, review_required: 0 });
  });

  it("treats wildcard characters as literal recipient search text", async () => {
    const { repository: r, owner } = await make();
    await create(r, owner, "Office 100%_complete");
    await create(r, owner, "Office 100AAcomplete");
    const result = await r.list({ userId: owner, search: "%_", limit: 20 });
    expect(result.items.map(item => item.recipientName)).toEqual(["Office 100%_complete"]);
    expect(result.stageCounts.review_required).toBe(1);
  });

  it("returns only latest, minimal feedback and marks multiple-attempt feedback as call-level", async () => {
    const { repository: r, owner } = await make();
    await r.grantSignupCredits(owner);
    const brief = await create(r, owner, "Feedback office");
    await r.approveCompilation(brief.id, await originalPlanReview(r, brief.id));
    await r.startAttempt(brief.id, { userId: owner, provider: "mock" });
    await r.stop(brief.id);
    for (const goalResult of ["no", "yes"] as const) await r.submitOwnerCallFeedback(brief.id, owner,
      { idempotencyKey: randomUUID(), goalResult, transcriptQuality: null, comment: "Private comment must not enter history" });
    const first = await r.list({ userId: owner, limit: 20 });
    expect(first.items[0]?.feedback).toMatchObject({ goalResult: "yes", revision: 2, scope: "current_attempt" });
    expect(Object.keys(first.items[0]!.feedback!).sort()).toEqual(["createdAt", "goalResult", "revision", "scope"]);
    expect(JSON.stringify(first)).not.toContain("Private comment");
    expect((await r.getCallOutcome(brief.id)).feedbackScope).toBe("current_attempt");
    expect((await r.getAdminCallInspector(brief.id))?.summary.feedback?.scope).toBe("current_attempt");
    await r.updateStatus(brief.id, "ready");
    await r.startAttempt(brief.id, { userId: owner, provider: "mock" });
    await r.stop(brief.id);
    expect((await r.list({ userId: owner, limit: 20 })).items[0]?.feedback?.scope).toBe("call");
    expect((await r.getCallOutcome(brief.id)).feedbackScope).toBe("call");
    expect((await r.getAdminCallInspector(brief.id))?.summary.feedback?.scope).toBe("call");
  });
}
