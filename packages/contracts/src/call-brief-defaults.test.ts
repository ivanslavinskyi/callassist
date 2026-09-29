import { expect, it } from "vitest";
import { applyCallBriefDefaults, createCallBriefInputSchema, CALL_BRIEF_INPUT_LIMITS } from "./call-brief";

const legacy = {
  recipientName: "Office", phoneNumber: "+41523686688", objective: "Ask for the document",
  assistantProfileId: "anna" as const, representedPersonFirstName: "Nina", representedPersonLastName: "Keller",
  locale: "de-CH" as const, context: "A previous request exists.",
  addressingMode: "informal" as const, tonePreference: "friendly" as const,
  resultHandling: "request_external_delivery" as const, deliveryInstruction: "Please email it to nina@example.com."
};
it.each(["user", "admin", undefined])("normalizes hidden legacy settings for %s and preserves delivery intent once", role => {
  const result = applyCallBriefDefaults(legacy, role);
  expect(result).toMatchObject({ addressingMode: "formal", tonePreference: "neutral", resultHandling: "capture_in_callassist", deliveryInstruction: "" });
  expect(result.context).toBe(legacy.context + "\n\n" + legacy.deliveryInstruction);
  expect(applyCallBriefDefaults(result, role)).toEqual(result);
  expect(legacy.tonePreference).toBe("friendly");
});
it("preserves only superadmin style overrides", () => {
  expect(applyCallBriefDefaults(legacy, "superadmin")).toMatchObject({ tonePreference: "friendly", addressingMode: "informal", resultHandling: "capture_in_callassist" });
});
it("exposes overlong migrated context to normal validation without truncating it", () => {
  const result = applyCallBriefDefaults({ ...legacy, context: "x".repeat(CALL_BRIEF_INPUT_LIMITS.context) });
  expect(result.context.endsWith(legacy.deliveryInstruction)).toBe(true);
  expect(createCallBriefInputSchema.safeParse(result).success).toBe(false);
});
