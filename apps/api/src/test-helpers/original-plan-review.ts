import type { CallSnapshot, CompilationReviewApprovalInput } from "@callassist/contracts";

/** Fixture action: the test caller explicitly reviews the current original, just like the original tab. */
export async function originalPlanReview(reader: { get(id: string): Promise<CallSnapshot | null> }, id: string): Promise<CompilationReviewApprovalInput> {
  const snapshot = await reader.get(id);
  if (!snapshot?.compilation) throw new Error("Fixture plan source is unavailable");
  return {
    revision: snapshot.compilation.revision, snapshotHash: snapshot.compilation.snapshotHash,
    review: { mode: "original", language: snapshot.compilation.rawBrief.locale,
      selectionRevision: snapshot.languageContext?.selectionRevision ?? 1 }
  };
}
