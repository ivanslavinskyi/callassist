import { describe, expect, it } from "vitest";
import type { ReviewEvidence } from "@callassist/contracts";
import { compilationApprovalInput } from "./compilation-approval";

const source = { revision: 3, snapshotHash: "a".repeat(64), approvedAt: null };
const viewedTranslation: ReviewEvidence = { mode: "translated", language: "ru", artifactId: "saved-reader",
  artifactHash: "b".repeat(64), selectionRevision: 2 };

describe("review and start retry authority", () => {
  it("binds first approval to the exact displayed translation", () => {
    expect(compilationApprovalInput(source, viewedTranslation)).toEqual({
      revision: source.revision, snapshotHash: source.snapshotHash, review: viewedTranslation
    });
  });

  it("does not replace an existing receipt when another reader is viewed before retrying start", () => {
    const approved = { ...source, approvedAt: "2026-09-09T12:00:00Z" };
    for (const view of [viewedTranslation, { mode: "original" as const, language: "de-CH", selectionRevision: 2 }]) {
      expect(compilationApprovalInput(approved, view)).toEqual({ revision: source.revision, snapshotHash: source.snapshotHash });
    }
  });
});
