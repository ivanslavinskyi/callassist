import type { CallCompilation, CompilationReviewApprovalInput, ReviewEvidence } from "@callassist/contracts";

/** Retry start against the stored receipt once approved; merely viewing another reader is not a new approval. */
export function compilationApprovalInput(compilation: Pick<CallCompilation, "revision" | "snapshotHash" | "approvedAt">,
  review?: ReviewEvidence): CompilationReviewApprovalInput {
  return { revision: compilation.revision, snapshotHash: compilation.snapshotHash,
    ...(!compilation.approvedAt && review ? { review } : {}) };
}
