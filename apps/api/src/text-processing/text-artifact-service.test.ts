import { describe, expect, it } from "vitest";
import type { CallSummaryPayload, SourceSegment } from "@callassist/contracts";
import { chunkBySize, combinePayloads } from "./text-artifact-service";
import { allTextDirections, textCapabilitiesFromEnv, textDirectionEnabled } from "./text-capabilities";
import { MockTextProcessor } from "./mock-text-processor";
import { OpenAITextProcessor } from "./openai-text-processor";

describe("text artifact orchestration boundaries", () => {
  it("chunks every source segment once in order and rejects excess instead of truncating", () => {
    const segments = Array.from({ length: 7 }, (_, index) => ({ id: `segment.${index}`, text: "x".repeat(14_000) }));
    const chunks = chunkBySize(segments);
    expect(chunks.length).toBe(7);
    expect(chunks.flat()).toEqual(segments);
    expect(() => chunkBySize([...segments, ...segments])).toThrow("TEXT_INPUT_TOO_LARGE");
    expect(() => chunkBySize([{ id: "large", text: "x".repeat(28_001) }])).toThrow("TEXT_INPUT_TOO_LARGE");
  });

  it("assembles translations while retaining source roles, time and order", () => {
    const segments: SourceSegment[] = [
      { id: "first", role: "recipient", text: "Нет.", startSeconds: 3, endSeconds: 4 },
      { id: "second", role: "unknown", text: "Только если получится.", startSeconds: null, endSeconds: null }
    ];
    expect(combinePayloads("transcript_translation", segments.map((segment) => ({ segments: [segment], text: segment.text })), "ru")).toEqual({
      segments, text: "Нет.\nТолько если получится."
    });
  });

  it("keeps contradictory chunk answers unresolved without inferring a successful commitment", () => {
    const summary = (answer: string): CallSummaryPayload => ({ answers: [{ question: "Is Friday possible?", answer, certainty: "reported", sourceSegmentIds: [answer] }], nextSteps: [], unresolved: [] });
    const result = combinePayloads("call_summary", [summary("Yes"), summary("No")], "ru") as CallSummaryPayload;
    expect(result.answers[0]).toMatchObject({ certainty: "unknown", sourceSegmentIds: ["Yes", "No"] });
    expect(result.answers[0]!.answer).toContain("оригинала");
    expect(result.nextSteps).toEqual([]);
  });

  it("enables real operation/direction independently from UI and voice locales", () => {
    const processor = new OpenAITextProcessor({ apiKey: "fixture", model: "fixture-model" });
    expect(textCapabilitiesFromEnv(processor, {})).toEqual({ enabled: false, directions: [] });
    const capabilities = textCapabilitiesFromEnv(processor, { TEXT_ARTIFACT_GENERATION_ENABLED: "true", TEXT_ARTIFACT_DIRECTIONS: "plan_review:de:ru,call_summary:*:uk" });
    expect(textDirectionEnabled(capabilities, "plan_review", "de-CH", "ru")).toBe(true);
    expect(textDirectionEnabled(capabilities, "transcript_translation", "de-CH", "ru")).toBe(false);
    expect(textDirectionEnabled(capabilities, "call_summary", "fr-CH", "uk")).toBe(true);
    expect(textDirectionEnabled({ enabled: true, directions: [{ kind: "transcript_translation", sourceLanguage: "de", targetLanguage: "ru" }] }, "transcript_translation", "*", "ru")).toBe(false);
    expect(textDirectionEnabled({ enabled: true, directions: [{ kind: "transcript_translation", sourceLanguage: "*", targetLanguage: "ru" }] }, "transcript_translation", "*", "ru")).toBe(true);
    expect(textCapabilitiesFromEnv(new MockTextProcessor(), {}).directions).toEqual(allTextDirections());
    expect(processor.generatorVersion).toContain("fixture-model");
  });

  it("preserves cited next steps from compatible chunks and deduplicates their evidence", () => {
    const first: CallSummaryPayload = { answers: [], nextSteps: [{ text: "Send the form.", sourceSegmentIds: ["segment.1"] }], unresolved: [] };
    const second: CallSummaryPayload = { answers: [], nextSteps: [
      { text: "Send the form.", sourceSegmentIds: ["segment.2"] },
      { text: "Call again after receiving a reply.", sourceSegmentIds: ["segment.3"] }
    ], unresolved: [] };
    expect((combinePayloads("call_summary", [first, second], "en") as CallSummaryPayload).nextSteps).toEqual([
      { text: "Send the form.", sourceSegmentIds: ["segment.1", "segment.2"] },
      { text: "Call again after receiving a reply.", sourceSegmentIds: ["segment.3"] }
    ]);
  });
});
