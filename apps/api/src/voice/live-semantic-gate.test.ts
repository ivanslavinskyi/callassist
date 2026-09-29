import { describe, expect, it, vi } from "vitest";
import { classifyLiveSemantics } from "./live-semantic-gate";
import type { OpenAILiveBridgeOptions } from "./openai-live-bridge";

const input = { kind: "speech" as const, locale: "en-GB" as const, expected: "May I record and transcribe?", received: "May I record and automatically transcribe this call?" };
const binding = { callBriefId: "brief", callAttemptId: "attempt", parentOperationId: "session" };
const semanticResponse = (decision: string) => new Response(JSON.stringify({ status: "completed", id: "response-id", model: "gpt-6-luna",
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ decision }) }] }],
  usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110, secret_text: "must not persist" }
}), { headers: { "x-request-id": "request-id" } });
function setup(semanticFetch = vi.fn<typeof fetch>(async () => semanticResponse("equivalent"))) {
  const service = { recordRealtimeProviderOperation: vi.fn(async () => {}), completeProviderOperation: vi.fn(async () => {}) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const options = { apiKey: "test", service, semanticFetch, logger } as unknown as OpenAILiveBridgeOptions;
  return { service, semanticFetch, logger, run: (signal = new AbortController().signal) => classifyLiveSemantics(options, binding, input, signal) };
}
describe("Live semantic safety classifier transport", () => {
  it("uses a silent structured response, no tools/storage/task context and accounts usage without text", async () => {
    const h = setup(); expect(await h.run()).toBe("equivalent");
    const request = JSON.parse(h.semanticFetch.mock.calls[0][1]!.body as string);
    expect(request).toMatchObject({ model: "gpt-6-luna", store: false, parallel_tool_calls: false,
      text: { format: { strict: true, type: "json_schema" } } });
    expect(request.tools).toBeUndefined();
    expect(JSON.parse(request.input[0].content)).toEqual(input);
    expect(h.service.recordRealtimeProviderOperation).toHaveBeenCalledWith(expect.objectContaining({ ...binding, stage: "live_speech_classification" }));
    expect(h.service.completeProviderOperation).toHaveBeenCalledWith(expect.objectContaining({ outcome: "succeeded",
      providerResponseId: "response-id", providerRequestId: "request-id", usage: expect.objectContaining({ totalTokens: 110 }) }));
    const persisted = JSON.stringify([h.service.recordRealtimeProviderOperation.mock.calls, h.service.completeProviderOperation.mock.calls]);
    expect(persisted).not.toContain(input.received); expect(persisted).not.toContain(input.expected); expect(persisted).not.toContain("must not persist");
    expect(h.logger.info).toHaveBeenCalledWith(expect.objectContaining({ stage: "speech", decision: "equivalent",
      outcome: "succeeded", receivedCharacters: input.received.length }), "Live semantic decision");
    const logs = JSON.stringify(h.logger.info.mock.calls);
    expect(logs).not.toContain(input.received); expect(logs).not.toContain(input.expected);
  });
  it.each(["affirmative", "yes", "", "grant_recording"])("never treats invalid enum %s as verified speech", async decision => {
    const h = setup(vi.fn(async () => semanticResponse(decision)));
    expect(await h.run()).toBe("unclear");
    expect(h.service.completeProviderOperation).toHaveBeenCalledWith(expect.objectContaining({ outcome: "provider_error" }));
    expect(h.logger.info).toHaveBeenCalledWith(expect.objectContaining({ decision: "unclear", outcome: "provider_error" }), "Live semantic decision");
  });
  it.each([400, 429, 500])("fails closed on HTTP %s", async status => {
    const h = setup(vi.fn(async () => new Response('{"error":{}}', { status })));
    expect(await h.run()).toBe("unclear");
  });
  it("fails closed on disconnect, refusal, incomplete response and malformed JSON", async () => {
    for (const result of [null, { status: "incomplete" }, { status: "completed", output: [{ type: "refusal" }] }]) {
      const h = setup(vi.fn(async () => { if (!result) throw new Error("network"); return new Response(JSON.stringify(result)); }));
      expect(await h.run()).toBe("unclear");
    }
  });
  it("does not call provider if ledger reservation fails", async () => {
    const h = setup(); h.service.recordRealtimeProviderOperation.mockRejectedValueOnce(new Error("database"));
    await expect(h.run()).rejects.toThrow("database"); expect(h.semanticFetch).not.toHaveBeenCalled();
  });
  it("propagates cancellation to provider and records unknown usage", async () => {
    const controller = new AbortController();
    const h = setup(vi.fn(async (_url, init) => {
      expect(init?.signal?.aborted).toBe(true); throw new Error("aborted");
    }));
    controller.abort(); expect(await h.run(controller.signal)).toBe("unclear");
    expect(h.service.completeProviderOperation).toHaveBeenCalledWith(expect.objectContaining({ usage: null,
      outcome: "network_error", errorCode: "LIVE_CLASSIFICATION_CANCELLED" }));
    expect(h.logger.warn).not.toHaveBeenCalled();
    expect(h.logger.info).toHaveBeenCalledWith(expect.objectContaining({ outcome: "cancelled" }), "Live semantic decision");
  });
});
