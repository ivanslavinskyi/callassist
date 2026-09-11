import type { SourceSegment } from "@callassist/contracts";
import { describe, expect, it, vi } from "vitest";
import { MockTextProcessor } from "./mock-text-processor";
import { OpenAITextProcessor, parseTextRetryAfter } from "./openai-text-processor";
import {
  createTextProcessorFromEnv,
  type TextProcessingInput,
  type TextProcessingProviderRequestResult
} from "./text-processor";

const plan: TextProcessingInput = {
  kind: "plan_review", targetLanguage: "ru",
  fields: [{ id: "objective", text: "Ask about opening hours." }, { id: "facts.0", text: "Do not book a visit." }]
};
const translatedPlan = { fields: [
  { id: "objective", text: "Уточнить часы работы." },
  { id: "facts.0", text: "Не записывать на приём." }
] };
const segments: SourceSegment[] = [
  { id: "segment.0", role: "assistant", text: "Is the office open?", startSeconds: 1, endSeconds: 3 },
  { id: "segment.1", role: "recipient", text: "We are open until 17:00.", startSeconds: 4, endSeconds: 6 }
];
const translation: TextProcessingInput = { kind: "transcript_translation", targetLanguage: "uk", segments };
const context = { objective: "Check office hours", taskType: "information_request", recipient: "Office", representedPerson: "Anna" };
const summary: TextProcessingInput = { kind: "call_summary", targetLanguage: "de", segments, checks: [{ id: "question.0", text: "When does the office close?" }], context };
const summaryOutput = {
  schemaVersion: 2, overview: [],
  findings: [{ id: "question.0", label: "Wann schliesst das Büro?", text: "Laut Auskunft um 17:00.", certainty: "reported", sourceSegmentIds: ["segment.1"] }],
  nextSteps: [], unresolved: []
};

function response(payload: unknown, extras: Record<string, unknown> = {}) {
  return Response.json({
    id: "response-1", model: "provider-model", status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(payload) }] }],
    usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 20 }, output_tokens: 50, total_tokens: 150 },
    ...extras
  }, { headers: { "x-request-id": "request-1" } });
}

function setup(payload: unknown) {
  const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(response(payload));
  const processor = new OpenAITextProcessor({ apiKey: "test-key", model: "test-model", fetchImplementation });
  const completed: TextProcessingProviderRequestResult[] = [];
  const before = vi.fn(async () => true);
  const options = {
    beforeProviderRequest: before,
    afterProviderRequest: async (result: TextProcessingProviderRequestResult) => { completed.push(result); }
  };
  return { processor, fetchImplementation, before, completed, options };
}

describe("OpenAI text transformations", () => {
  it("uses explicit target language, strict structured output, and bills one validated result", async () => {
    const fixture = setup(translatedPlan);
    expect(await fixture.processor.process(plan, fixture.options)).toEqual(translatedPlan);
    const request = fixture.fetchImplementation.mock.calls[0]![1]!;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({ model: "test-model", store: false, max_output_tokens: 16384, text: { format: { type: "json_schema", strict: true } } });
    expect(JSON.parse(body.input[1].content)).toEqual(plan);
    expect(body.input[0].content).toContain("untrusted source material");
    expect(body.input[0].content).toContain("Never add a commitment");
    expect(body).not.toHaveProperty("tools");
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(fixture.before).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      kind: "plan_review", operationType: "text_translation", provider: "openai", model: "test-model"
    }));
    expect(fixture.completed).toEqual([expect.objectContaining({
      outcome: "succeeded", providerRequestId: "request-1", providerResponseId: "response-1", providerModel: "provider-model", statusCode: 200,
      usage: expect.objectContaining({ inputTextTokens: 100, cachedInputTextTokens: 20, outputTextTokens: 50, totalTokens: 150 })
    })]);
  });

  it("builds transcript metadata and combined text from the immutable source", async () => {
    const fixture = setup({ segments: [
      { id: "segment.0", text: "Офіс відчинений?" },
      { id: "segment.1", text: "Ми працюємо до 17:00." }
    ] });
    await expect(fixture.processor.process(translation)).resolves.toEqual({
      segments: [
        { ...segments[0], text: "Офіс відчинений?" },
        { ...segments[1], text: "Ми працюємо до 17:00." }
      ], text: "Офіс відчинений?\nМи працюємо до 17:00."
    });
    expect(segments[0]?.text).toBe("Is the office open?");
  });

  it.each([
    { fields: [translatedPlan.fields[1], translatedPlan.fields[0]] },
    { fields: [translatedPlan.fields[0]] },
    { fields: [translatedPlan.fields[0], translatedPlan.fields[0]] },
    { fields: [...translatedPlan.fields, { id: "new.permission", text: "Book now" }] },
    { ...translatedPlan, approved: true },
    { fields: [{ ...translatedPlan.fields[0], scope: "new" }, translatedPlan.fields[1]] }
  ])("rejects altered plan structure and still accounts for provider usage", async (invalid) => {
    const fixture = setup(invalid);
    await expect(fixture.processor.process(plan, fixture.options)).rejects.toMatchObject({ code: "TEXT_RESPONSE_INVALID" });
    expect(fixture.completed).toEqual([expect.objectContaining({
      outcome: "invalid_response", usage: expect.objectContaining({ totalTokens: 150 })
    })]);
    expect(fixture.fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("rejects provider attempts to change roles or timestamps", async () => {
    const fixture = setup({ segments: segments.map((segment) => ({ ...segment, text: "translated" })) });
    await expect(fixture.processor.process(translation)).rejects.toMatchObject({ code: "TEXT_RESPONSE_INVALID" });
  });

  it("rejects lost or invented protected identifiers in translations", async () => {
    const input: TextProcessingInput = {
      kind: "plan_review", targetLanguage: "ru",
      fields: [{ id: "fact", text: "Email nina@example.com; reference ABC12345." }]
    };
    for (const text of [
      "Email other@example.com; reference ABC12345.",
      "Email nina@example.com; reference ABC54321.",
      "Email nina@example.com; reference ABC12345. Copy to new@example.com."
    ]) {
      const fixture = setup({ fields: [{ id: "fact", text }] });
      await expect(fixture.processor.process(input)).rejects.toMatchObject({ code: "TEXT_RESPONSE_INVALID" });
    }
  });

  it("requires real source references for known findings and permits explicit unknowns", async () => {
    const known = setup(summaryOutput);
    await expect(known.processor.process(summary, known.options)).resolves.toMatchObject({
      findings: [{ label: "Wann schliesst das Büro?", sourceSegmentIds: ["segment.1"] }]
    });
    expect(known.before).toHaveBeenCalledWith(expect.objectContaining({ operationType: "call_summary" }));
    const unknown = setup({ schemaVersion: 2, overview: [], findings: [{
      id: "question.0", label: "Wann schliesst das Büro?",
      text: "Die Schliesszeit wurde nicht geklärt.", certainty: "unknown", sourceSegmentIds: []
    }], nextSteps: [], unresolved: ["Schliesszeit nicht bestätigt"] });
    await expect(unknown.processor.process(summary)).resolves.toMatchObject({ findings: [{ certainty: "unknown", sourceSegmentIds: [] }] });
  });

  it("rejects changed amounts even when a summary cites an existing segment", async () => {
    const input: TextProcessingInput = { kind: "call_summary", targetLanguage: "ru",
      context, checks: [{ id: "question.0", text: "What is the price?" }], segments: [{ ...segments[1]!, text: "It costs CHF 25." }] };
    const output = { schemaVersion: 2, overview: [], findings: [{ id: "question.0", label: "Какова цена?", text: "Стоимость — CHF 250.", certainty: "reported", sourceSegmentIds: ["segment.1"] }], nextSteps: [], unresolved: [] };
    const invalid = setup(output);
    await expect(invalid.processor.process(input, invalid.options)).rejects.toMatchObject({ code: "TEXT_RESPONSE_INVALID" });
    expect(invalid.completed[0]?.outcome).toBe("invalid_response");
    const valid = setup({ ...output, findings: [{ ...output.findings[0], text: "Стоимость — CHF 25." }] });
    await expect(valid.processor.process(input)).resolves.toMatchObject({ findings: [{ text: "Стоимость — CHF 25." }] });
  });

  it("preserves numeric facts in both directions of a translation", async () => {
    const input: TextProcessingInput = { kind: "plan_review", targetLanguage: "ru", fields: [{ id: "fact", text: "Maximum CHF 25; 17.09.2026 at 17:00." }] };
    for (const text of ["Максимум CHF 250; 17.09.2026 в 17:00.", "Максимум CHF 25; 17.09.2026."]) {
      const fixture = setup({ fields: [{ id: "fact", text }] });
      await expect(fixture.processor.process(input)).rejects.toMatchObject({ code: "TEXT_RESPONSE_INVALID" });
    }
    const valid = setup({ fields: [{ id: "fact", text: "Максимум CHF 25; 17.09.2026 в 17:00." }] });
    await expect(valid.processor.process(input)).resolves.toMatchObject({ fields: [{ id: "fact" }] });
  });

  it.each([
    { ...summaryOutput, findings: [{ ...summaryOutput.findings[0], sourceSegmentIds: [] }] },
    { ...summaryOutput, findings: [{ ...summaryOutput.findings[0], sourceSegmentIds: ["foreign"] }] },
    { ...summaryOutput, findings: [{ ...summaryOutput.findings[0], sourceSegmentIds: ["segment.1", "segment.1"] }] },
    { ...summaryOutput, findings: [{ ...summaryOutput.findings[0], id: "question.9" }] },
    { ...summaryOutput, findings: [] },
    { ...summaryOutput, nextSteps: [{ text: "Pay now", sourceSegmentIds: [] }] },
    { ...summaryOutput, nextSteps: [{ text: "Pay now", sourceSegmentIds: ["foreign"] }] }
  ])("rejects incomplete or unsupported summary evidence", async (invalid) => {
    const fixture = setup(invalid);
    await expect(fixture.processor.process(summary)).rejects.toMatchObject({ code: "TEXT_RESPONSE_INVALID" });
  });

  it("denies budget before invoking fetch and does not report an unsent request", async () => {
    const fixture = setup(translatedPlan);
    fixture.before.mockResolvedValue(false);
    await expect(fixture.processor.process(plan, fixture.options)).rejects.toMatchObject({ code: "TEXT_REQUEST_BUDGET_EXHAUSTED" });
    await expect(fixture.processor.process(plan, { maxProviderRequests: 0 })).rejects.toMatchObject({ code: "TEXT_REQUEST_BUDGET_EXHAUSTED" });
    expect(fixture.fetchImplementation).not.toHaveBeenCalled();
    expect(fixture.completed).toEqual([]);
  });

  it("requires complete checks, validates overview links, and rejects ungrounded shortened claims", async () => {
    for (const change of [
      { overview: [{ label: "Hours", text: "Until 17:00.", findingIds: ["foreign"] }] },
      { overview: [{ label: null, text: "Until 18:00.", findingIds: ["question.0"] }] },
      { overview: [{ label: null, text: "Until 17:00.", findingIds: ["question.0", "question.0"] }] },
      { schemaVersion: 1 },
      { answers: [] }
    ]) {
      const fixture = setup({ ...summaryOutput, ...change });
      await expect(fixture.processor.process(summary)).rejects.toMatchObject({ code: "TEXT_RESPONSE_INVALID" });
    }
    const fixture = setup({ ...summaryOutput, overview: [{ label: "Hours", text: "Until 17:00.", findingIds: ["question.0"] }] });
    await expect(fixture.processor.process(summary)).resolves.toHaveProperty("schemaVersion", 2);
  });

  it("does not treat planned numbers as evidence for a claimed result", async () => {
    const input = { ...summary, checks: [{ id: "question.0", text: "Is it open until 18:00?" }] };
    const fixture = setup({ ...summaryOutput, findings: [{ ...summaryOutput.findings[0], text: "Open until 18:00." }] });
    await expect(fixture.processor.process(input)).rejects.toMatchObject({ code: "TEXT_RESPONSE_INVALID" });
  });

  it("allows compaction only when detailed certainty, sources and actions stay unchanged", async () => {
    const extraction = await setup(summaryOutput).processor.process(summary);
    if (!("findings" in extraction)) throw new Error("Unexpected payload");
    const input = { ...summary, extraction };
    for (const change of [
      { findings: [{ ...extraction.findings[0], certainty: "conditional" }] },
      { nextSteps: [{ text: "Call again", sourceSegmentIds: ["segment.1"] }] },
      { unresolved: ["A new warning"] }
    ]) {
      await expect(setup({ ...extraction, ...change }).processor.process(input)).rejects.toMatchObject({ code: "TEXT_RESPONSE_INVALID" });
    }
    await expect(setup({ ...extraction, overview: [{ label: null, text: "Open until 17:00.", findingIds: ["question.0"] }] }).processor.process(input)).resolves.toHaveProperty("overview");
  });

  it("accounts for network errors and HTTP errors without retrying internally", async () => {
    const fixture = setup(translatedPlan);
    fixture.fetchImplementation.mockRejectedValueOnce(new Error("network failure"));
    await expect(fixture.processor.process(plan, fixture.options)).rejects.toMatchObject({ code: "TEXT_REQUEST_FAILED" });
    fixture.fetchImplementation.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    await expect(fixture.processor.process(plan, fixture.options)).rejects.toMatchObject({ code: "TEXT_PROVIDER_UNAVAILABLE", retryable: true });
    expect(fixture.completed.map((result) => result.outcome)).toEqual(["network_error", "provider_error"]);
    expect(fixture.fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it.each([429, 503, 408, 400, 401, 403])("classifies HTTP %s and preserves bounded Retry-After for scheduling", async status => {
    const fixture = setup(translatedPlan);
    fixture.fetchImplementation.mockResolvedValueOnce(new Response("Unavailable", { status, headers: { "retry-after": "120" } }));
    await expect(fixture.processor.process(plan, fixture.options)).rejects.toMatchObject({
      retryable: status === 429 || status === 503 || status === 408, retryAfterMs: 120_000
    });
    expect(fixture.completed[0]?.errorCode).toBe(status === 429 ? "TEXT_RATE_LIMITED" : status === 503 ? "TEXT_PROVIDER_UNAVAILABLE" : status === 408 ? "TEXT_REQUEST_TIMEOUT" : "TEXT_REQUEST_REJECTED");
  });

  it("bounds provider backoff and accepts seconds or an HTTP date", () => {
    const now = Date.parse("2026-09-11T00:00:00Z");
    expect(parseTextRetryAfter("120", now)).toBe(120_000);
    expect(parseTextRetryAfter("Fri, 11 Sep 2026 00:02:00 GMT", now)).toBe(120_000);
    expect(parseTextRetryAfter("999999999", now)).toBe(900_000);
    expect(parseTextRetryAfter("invalid", now)).toBeUndefined();
    expect(parseTextRetryAfter(null, now)).toBeUndefined();
  });

  it("distinguishes timeout and caller cancellation, with a separate summary deadline", async () => {
    const timeouts: number[] = [];
    const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => { timeouts.push(ms); return originalTimeout(1); });
    const fetchImplementation = vi.fn<typeof fetch>(async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
    }));
    try {
      const processor = new OpenAITextProcessor({ apiKey: "fixture", fetchImplementation });
      await expect(processor.process(plan)).rejects.toMatchObject({ code: "TEXT_REQUEST_TIMEOUT", retryable: true });
      await expect(processor.process(summary)).rejects.toMatchObject({ code: "TEXT_REQUEST_TIMEOUT", retryable: true });
      expect(timeouts).toEqual([45_000, 90_000]);
      const controller = new AbortController(); controller.abort();
      await expect(processor.process(summary, { signal: controller.signal })).rejects.toMatchObject({ code: "TEXT_REQUEST_CANCELLED", retryable: false });
      expect(fetchImplementation).toHaveBeenCalledTimes(2);
    } finally { spy.mockRestore(); }
  });

  it.each([
    () => response(translatedPlan, { status: "incomplete" }),
    () => response(translatedPlan, { output: [{ content: [{ type: "refusal", refusal: "Cannot comply" }] }] }),
    () => new Response("not JSON"),
    () => new Response("x".repeat(2_000_001))
  ])("rejects incomplete, refused or malformed envelopes and records the attempt", async (makeResponse) => {
    const fixture = setup(translatedPlan);
    fixture.fetchImplementation.mockResolvedValueOnce(makeResponse());
    await expect(fixture.processor.process(plan, fixture.options)).rejects.toMatchObject({ code: "TEXT_RESPONSE_INVALID" });
    expect(fixture.completed).toHaveLength(1);
    expect(fixture.completed[0]?.outcome).toBe("invalid_response");
  });

  it("does not return generated content if accounting fails", async () => {
    const fixture = setup(translatedPlan);
    await expect(fixture.processor.process(plan, {
      afterProviderRequest: async () => { throw new Error("accounting unavailable"); }
    })).rejects.toThrow("accounting unavailable");
    expect(fixture.fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized, duplicate or reversed-time sources before a paid request", async () => {
    const fixture = setup(translatedPlan);
    await expect(fixture.processor.process({
      kind: "transcript_translation", targetLanguage: "de",
      segments: [{ ...segments[0]!, text: "x".repeat(60_001) }]
    })).rejects.toMatchObject({ code: "TEXT_INPUT_TOO_LARGE" });
    await expect(fixture.processor.process({
      ...translation, segments: [segments[0]!, segments[0]!]
    })).rejects.toMatchObject({ code: "TEXT_INPUT_INVALID" });
    await expect(fixture.processor.process({
      ...translation, segments: [{ ...segments[0]!, startSeconds: 10, endSeconds: 2 }]
    })).rejects.toMatchObject({ code: "TEXT_INPUT_INVALID" });
    expect(fixture.fetchImplementation).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(fixture.processor.process(plan, { signal: controller.signal })).rejects.toMatchObject({ code: "TEXT_REQUEST_CANCELLED" });
    expect(fixture.fetchImplementation).not.toHaveBeenCalled();
  });
});

describe("mock and configuration", () => {
  it("is visibly untranslated by default and never manufactures factual summaries", async () => {
    const processor = new MockTextProcessor();
    await expect(processor.process(plan)).resolves.toMatchObject({ fields: [{
      id: "objective", text: "[MOCK ru: untranslated source] Ask about opening hours."
    }, expect.anything()] });
    await expect(processor.process(summary)).resolves.toMatchObject({ findings: [{
      certainty: "unknown", text: "[MOCK: no factual summary has been generated]", sourceSegmentIds: []
    }], nextSteps: [] });
    await expect(new MockTextProcessor({ fixture: () => translatedPlan }).process(plan)).resolves.toEqual(translatedPlan);
  });

  it("uses explicit drivers and model fallback without implicitly enabling a provider from its key", () => {
    expect(createTextProcessorFromEnv({ OPENAI_API_KEY: "test-key" }).driver).toBe("mock");
    expect(createTextProcessorFromEnv({ BRIEF_COMPILER_DRIVER: "openai", OPENAI_API_KEY: "test-key", OPENAI_BRIEF_COMPILER_MODEL: "compiler-model" }).model).toBe("compiler-model");
    expect(createTextProcessorFromEnv({ TEXT_PROCESSOR_DRIVER: "openai", OPENAI_API_KEY: "test-key", TEXT_PROCESSOR_MODEL: "text-model", OPENAI_BRIEF_COMPILER_MODEL: "compiler-model" }).model).toBe("text-model");
    expect(() => createTextProcessorFromEnv({ TEXT_PROCESSOR_DRIVER: "invalid" })).toThrow("Unsupported");
    expect(() => createTextProcessorFromEnv({ TEXT_PROCESSOR_DRIVER: "openai" })).toThrow("OPENAI_API_KEY");
    expect(() => createTextProcessorFromEnv({ TEXT_PROCESSOR_DRIVER: "openai", OPENAI_API_KEY: "test-key", TEXT_PROCESSOR_TIMEOUT_MS: "0" })).toThrow("TEXT_PROCESSOR_TIMEOUT_MS");
  });
});
