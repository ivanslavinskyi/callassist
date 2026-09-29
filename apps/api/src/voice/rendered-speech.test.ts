import { describe, expect, it, vi } from "vitest";
import { pcm24kToPcmu8k, renderSpeech } from "./rendered-speech";

describe("application-owned rendered speech", () => {
  it("requests exact text with the approved voice and emits 20 ms PCMU frames", async () => {
    const pcm = Buffer.alloc(24_000 * 2); // one second of mono PCM16 silence
    const speechFetch = vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(init!.body as string);
      expect(request).toMatchObject({ model: "gpt-4o-mini-tts", voice: "marin",
        input: "Exact disclosure", response_format: "pcm" });
      expect(request.instructions).toContain("de-CH");
      return new Response(pcm, { headers: { "x-request-id": "req-speech" } });
    });
    const rendered = await renderSpeech({ apiKey: "test", text: "Exact disclosure", locale: "de-CH",
      voice: "marin", speechFetch });
    expect(rendered).toMatchObject({ durationMs: 1_000, model: "gpt-4o-mini-tts", providerRequestId: "req-speech" });
    expect(rendered.frames).toHaveLength(50);
    expect(Buffer.concat(rendered.frames.map(frame => Buffer.from(frame, "base64")))).toEqual(Buffer.alloc(8_000, 255));
  });

  it("downsamples three PCM16 samples into one mu-law sample", () => {
    const pcm = Buffer.alloc(12);
    expect(pcm24kToPcmu8k(pcm)).toEqual(Buffer.from([255, 255]));
  });

  it("rejects provider errors and malformed PCM", async () => {
    await expect(renderSpeech({ apiKey: "test", text: "x", locale: "en-GB", voice: "cedar",
      speechFetch: vi.fn<typeof fetch>(async () => new Response("no", { status: 503 })) }))
      .rejects.toThrow("SPEECH_RENDER_PROVIDER_ERROR_503");
    await expect(renderSpeech({ apiKey: "test", text: "x", locale: "en-GB", voice: "cedar",
      speechFetch: vi.fn<typeof fetch>(async () => new Response(Buffer.from([1]))) }))
      .rejects.toThrow("SPEECH_RENDER_INVALID_AUDIO");
  });
});
