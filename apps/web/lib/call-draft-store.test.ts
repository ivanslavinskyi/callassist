import type { CreateCallBriefInput } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { CallDraftStore, type CallDraft } from "./call-draft-store";

function draft(): CallDraft {
  return {
    form: { objective: "Узнать часы работы", locale: "de-CH", allowedFacts: [] } as unknown as CreateCallBriefInput,
    factsText: "  незавершённый факт\n\nещё ",
    languagePreferences: { mode: "manual", targetLanguage: "ru", uiLocaleHint: "en" },
    preparationAttempt: { version: 2, userId: "owner-a", fingerprint: "a".repeat(64), idempotencyKey: "operation-a", createdAt: 1000 }
  };
}

describe("root-layout call drafts", () => {
  it("preserves unparsed facts, language intent and preparation when a locale subtree remounts", () => {
    const root = new CallDraftStore();
    root.forOwner("owner-a").set("owner-a", "new", draft());
    const restored = root.forOwner("owner-a").get("owner-a", "new");
    expect(restored).toEqual(draft());
    expect(restored?.languagePreferences.uiLocaleHint).toBe("en");
    expect(root.get("owner-a", "different-call")).toBeUndefined();
  });

  it("erases a previous account and ignores its late preparation response", () => {
    const root = new CallDraftStore();
    root.forOwner("owner-a").set("owner-a", "new", draft());
    root.forOwner("owner-b");
    root.set("owner-a", "new", draft());
    expect(root.get("owner-a", "new")).toBeUndefined();
    expect(root.get("owner-b", "new")).toBeUndefined();
  });

  it("clears finished/cancelled drafts and all drafts at logout", () => {
    const root = new CallDraftStore().forOwner("owner-a");
    root.set("owner-a", "new", draft()); root.set("owner-a", "edit", draft());
    root.clear("owner-a", "edit");
    expect(root.get("owner-a", "edit")).toBeUndefined();
    expect(root.get("owner-a", "new")).toBeDefined();
    root.clearAll(); root.set("owner-a", "new", draft());
    expect(root.get("owner-a", "new")).toBeUndefined();
  });
});
