import { describe, expect, it } from "vitest";
import { validateTextProcessingOutput } from "./text-validation";
import { compatibleTextGeneratorVersion, textGeneratorVersion } from "./text-processor";

describe.each(["plan_review", "clarification_review"] as const)("%s display translation", (kind) => {
  it.each([
    ["Встреча длится 15 минут.", "A 15-minute meeting."],
    ["A 15-minute meeting.", "A meeting lasting 15 minutes."],
    ["Ein 15-minütiges Treffen.", "A meeting lasting 15 minutes."],
    ["Встреча в 14:00.", "The meeting is at 2:00 PM."],
    ["Twenty-four November.", "24 ноября."],
    ["CHF 1'200.50", "1 200,50 CHF"]
  ])("accepts natural translation and formatting: %s", (source, target) => {
    expect(validateTextProcessingOutput(
      { kind, targetLanguage: "en", fields: [{ id: "objective", text: source }] },
      { fields: [{ id: "objective", text: target }] }
    )).toEqual({ fields: [{ id: "objective", text: target }] });
  });

  const fields = [{ id: "objective", text: "Task" }, { id: "fact.0", text: "Fact" }];
  it.each([
    {}, { fields: [] }, { fields: fields.slice(0, 1) },
    { fields: [...fields].reverse() }, { fields: [fields[0], fields[0]] },
    { fields: [...fields, { id: "invented", text: "Extra" }] },
    { fields: [{ ...fields[0], text: " " }, fields[1]] },
    { fields: [{ ...fields[0], text: "x".repeat(24_001) }, fields[1]] },
    { fields: [{ ...fields[0], action: "book" }, fields[1]] },
    { fields, approved: true }
  ])("rejects a malformed or mismatched field mapping %#", (payload) => {
    expect(() => validateTextProcessingOutput({ kind, targetLanguage: "ru", fields }, payload)).toThrow();
  });

  it("preserves the validation contract of already queued historical work", () => {
    expect(() => validateTextProcessingOutput(
      { kind, targetLanguage: "en", fields: [{ id: "objective", text: "Встреча длится 15 минут." }] },
      { fields: [{ id: "objective", text: "A 15-minute meeting." }] },
      { legacyReviewValidation: true }
    )).toThrow();
  });
});

it.each([
  ["Reference AB-17", "Reference AB-71"],
  ["Reference abc-15", "Reference abc-51"],
  ["Email nina@example.test", "Email mina@example.test"],
  ["Phone +41710000001", "Phone +41710000002"],
  ["Meet at 14:00", "Meet at 16:00"],
  ["Cost 120 CHF", "Cost 900 CHF"]
])("keeps transcript evidence checks unchanged: %s", (source, target) => {
  expect(() => validateTextProcessingOutput({ kind: "transcript_translation", targetLanguage: "en",
    segments: [{ id: "segment.0", role: "recipient", text: source, startSeconds: 0, endSeconds: 1 }] },
  { segments: [{ id: "segment.0", text: target }] })).toThrow();
});

it("versions only new reviews and preserves summary/transcript identities", () => {
  const processor = { generatorVersion: "text-processing-v2:openai:gpt-5.6" };
  const reviewVersion = `review-translation-v1:${processor.generatorVersion}`;
  expect(textGeneratorVersion(processor, "plan_review")).toBe(reviewVersion);
  expect(textGeneratorVersion(processor, "clarification_review")).toBe(reviewVersion);
  expect(textGeneratorVersion(processor, "transcript_translation")).toBe(processor.generatorVersion);
  expect(textGeneratorVersion(processor, "call_summary")).toBe(`summary-v9:grounded-v3:${processor.generatorVersion}`);
  expect(compatibleTextGeneratorVersion(processor.generatorVersion, reviewVersion, "plan_review")).toBe(true);
  expect(compatibleTextGeneratorVersion("text-processing-v2:openai:other-model", reviewVersion, "plan_review")).toBe(false);
  expect(compatibleTextGeneratorVersion(processor.generatorVersion, reviewVersion, "call_summary")).toBe(false);
});
