import type { CallSnapshot } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { currentCallSnapshot } from "./current-call-snapshot";

const current = { brief: { id: "call", updatedAt: "2026-09-09T12:00:00Z" }, compilation: { revision: 2 },
  languageContext: { taskContentLanguage: "uk", selectionRevision: 3, compilationRevision: 2 }
} as CallSnapshot;
describe("late call responses", () => {
  it("ignores an earlier compilation even when its request completes later", () => {
    expect(currentCallSnapshot(current, { ...current, compilation: { ...current.compilation!, revision: 1 } })).toBe(current);
  });
  it("accepts status updates without undoing a newer manual language selection", () => {
    const incoming = { ...current, languageContext: { ...current.languageContext!, taskContentLanguage: "ru" as const, selectionRevision: 2 } };
    expect(currentCallSnapshot(current, incoming).languageContext?.taskContentLanguage).toBe("uk");
  });
  it("accepts removal of sensitive content after deletion", () => {
    const removed = { ...current, compilation: null, languageContext: null };
    expect(currentCallSnapshot(current, removed)).toBe(removed);
  });
});
