import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCreateCallBriefInput } from "@callassist/contracts";
import { DeterministicBriefCompiler, OpenAIBriefCompiler, type BriefCompilerProviderRequestResult } from "./brief-compiler";
import { createBriefCompilerFromEnv } from "./create-brief-compiler";

const input = normalizeCreateCallBriefInput({
  recipientName: "Test office", phoneNumber: "+41525550123", representedPersonFirstName: "QA", representedPersonLastName: "Tester",
  objective: "Ask whether the office opens on Saturday", locale: "en-GB", allowedFacts: [], context: "", assistantProfileId: "sebastian"
});
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const moderationResponse = () => new Response(JSON.stringify({ results: [{ flagged: false }] }));
async function compilationResponse() {
  const compiled = (await new DeterministicBriefCompiler().compile(input)).compiledBrief!;
  return { output_text: JSON.stringify({ ...compiled, schedulingInterpretation: { intent: "none", authorityEvidence: null, schedule: null } }) };
}

describe("stage-aware compiler deadlines", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("lets a 40-second generation finish while moderation keeps its own short deadline", async () => {
    const payload = await compilationResponse();
    const results: BriefCompilerProviderRequestResult[] = [];
    let generationSignal: AbortSignal | null = null;
    const fetchImplementation = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("moderations")) {
        await wait(1_000);
        return moderationResponse();
      }
      generationSignal = init!.signal as AbortSignal;
      await wait(40_000);
      return new Response(JSON.stringify(payload));
    });
    let finished = false;
    const pending = new OpenAIBriefCompiler({ apiKey: "test", fetchImplementation }).compile(input, 1, {
      afterProviderRequest: async (result) => { results.push(result); }
    }).then((result) => { finished = true; return result; });
    await vi.advanceTimersByTimeAsync(26_000);
    expect(finished).toBe(false);
    expect(generationSignal).not.toBeNull();
    expect((generationSignal as unknown as AbortSignal).aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(16_000);
    expect((await pending).policyDecision.status).toBe("ready_for_review");
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(results.map(({ stage, durationMs }) => [stage, durationMs])).toEqual([
      ["input_moderation", 1_000], ["compilation", 40_000], ["output_moderation", 1_000]
    ]);
  });

  it("retains the explicit environment request timeout for generation and moderation", async () => {
    const payload = await compilationResponse();
    const signals: AbortSignal[] = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("moderations")) return moderationResponse();
      signals.push(init!.signal as AbortSignal);
      await wait(40_000);
      return new Response(JSON.stringify(payload));
    });
    vi.stubGlobal("fetch", fetchImplementation);
    const compiler = createBriefCompilerFromEnv({ BRIEF_COMPILER_DRIVER: "openai", OPENAI_API_KEY: "test",
      OPENAI_BRIEF_COMPILER_REQUEST_TIMEOUT_MS: "30000", OPENAI_BRIEF_COMPILER_TIMEOUT_MS: "120000" });
    const result = compiler.compile(input).then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toMatchObject({ code: "OPENAI_REQUEST_FAILED", stage: "compilation" });
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);

    const moderationFetch = vi.fn<typeof fetch>(async () => { await wait(6_000); return moderationResponse(); });
    const moderationResult = new OpenAIBriefCompiler({ apiKey: "test", requestTimeoutMs: 5_000, fetchImplementation: moderationFetch })
      .compile(input).then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await moderationResult).toMatchObject({ code: "OPENAI_REQUEST_FAILED", stage: "input_moderation" });
    expect(moderationFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps 25-second default moderation attempts instead of giving them the generation timeout", async () => {
    const results: BriefCompilerProviderRequestResult[] = [];
    const fetchImplementation = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    const pending = new OpenAIBriefCompiler({ apiKey: "test", fetchImplementation }).compile(input, 1, {
      afterProviderRequest: async (result) => { results.push(result); }
    }).then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(await pending).toMatchObject({ code: "OPENAI_REQUEST_FAILED", stage: "input_moderation" });
    expect(results.map(({ durationMs }) => durationMs)).toEqual([25_000, 25_000]);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("caps generation retries at the same deadline and leaves 25 seconds for output moderation", async () => {
    const payload = await compilationResponse();
    const results: BriefCompilerProviderRequestResult[] = [];
    let generations = 0;
    let moderations = 0;
    const fetchImplementation = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("moderations")) {
        if (++moderations === 2) await wait(25_000);
        return moderationResponse();
      }
      await wait(++generations === 1 ? 60_000 : 35_000);
      return new Response(JSON.stringify(payload));
    });
    // The first generation reaches its 60s cap; the second is capped by the 95s generation deadline.
    const pending = new OpenAIBriefCompiler({ apiKey: "test", fetchImplementation }).compile(input, 1, {
      afterProviderRequest: async (result) => { results.push(result); }
    }).then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(95_000);
    expect(await pending).toMatchObject({ code: "OPENAI_REQUEST_FAILED", stage: "compilation" });
    expect(results.filter(({ stage }) => stage === "compilation").map(({ durationMs }) => durationMs)).toEqual([60_000, 35_000]);
    expect(moderations).toBe(1);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it("reserves output moderation time after a successful late generation retry", async () => {
    const payload = await compilationResponse();
    let generations = 0;
    let moderations = 0;
    const results: BriefCompilerProviderRequestResult[] = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("moderations")) {
        if (++moderations === 2) await wait(24_000);
        return moderationResponse();
      }
      if (++generations === 1) return new Promise<Response>(() => undefined);
      await wait(34_000);
      return new Response(JSON.stringify(payload));
    });
    const pending = new OpenAIBriefCompiler({ apiKey: "test", fetchImplementation }).compile(input, 1, {
      afterProviderRequest: async (result) => { results.push(result); }
    });
    await vi.advanceTimersByTimeAsync(118_000);
    expect((await pending).policyDecision.status).toBe("ready_for_review");
    expect(results.map(({ stage, durationMs }) => [stage, durationMs])).toEqual([
      ["input_moderation", 0], ["compilation", 60_000], ["compilation", 34_000], ["output_moderation", 24_000]
    ]);
  });

  it("bounds body reading after successful HTTP headers, including an explicit smaller total deadline", async () => {
    const signals: AbortSignal[] = [];
    const results: BriefCompilerProviderRequestResult[] = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("moderations")) return moderationResponse();
      signals.push(init!.signal as AbortSignal);
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"output_text":')); } }),
        { status: 200, headers: { "x-request-id": "headers_received_body_stalled" } });
    });
    const pending = new OpenAIBriefCompiler({ apiKey: "test", timeoutMs: 20_000, fetchImplementation }).compile(input, 1, {
      afterProviderRequest: async (result) => { results.push(result); }
    }).then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toMatchObject({ code: "OPENAI_REQUEST_FAILED", stage: "compilation" });
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(true);
    expect(results.at(-1)).toMatchObject({ outcome: "network_error", statusCode: 200,
      providerRequestId: "headers_received_body_stalled", durationMs: 15_000 });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("caps final moderation by the global deadline even when its second request would normally have 25 seconds", async () => {
    const payload = await compilationResponse();
    let moderationCalls = 0;
    let generationCalls = 0;
    const results: BriefCompilerProviderRequestResult[] = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("moderations")) {
        if (++moderationCalls === 1) return moderationResponse();
        return new Promise<Response>(() => undefined);
      }
      if (++generationCalls === 1) return new Promise<Response>(() => undefined);
      await wait(34_000);
      return new Response(JSON.stringify(payload));
    });
    const pending = new OpenAIBriefCompiler({ apiKey: "test", fetchImplementation }).compile(input, 1, {
      afterProviderRequest: async (result) => { results.push(result); }
    }).then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await pending).toMatchObject({ code: "OPENAI_REQUEST_FAILED", stage: "output_moderation" });
    expect(results.filter(({ stage }) => stage === "output_moderation").map(({ durationMs }) => durationMs)).toEqual([25_000, 1_000]);
  });
});
