import { describe, expect, it, vi } from "vitest";
import { readProviderResponse, retryAfterMs, providerBackoffMs } from "./response-reader";

function streamed(text: string, chunkSize = 1) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.slice(offset, offset + chunkSize));
    controller.close();
  } }), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}
describe("bounded Responses stream", () => {
  it("cancels runaway JSON padding across deltas before waiting for completion", async () => {
    const delta = (text: string) => `data: ${JSON.stringify({type:"response.output_text.delta",delta:text})}\n\n`;
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({start(controller) {
      controller.enqueue(new TextEncoder().encode(delta('{"text":"Lunch", "purpose":"Ask"') + delta('\n'.repeat(180)) + delta(' \r\n'.repeat(30))));
      // No terminal event: the real failure kept streaming whitespace until timeout.
    }, cancel}), {headers:{"content-type":"text/event-stream"}});
    await expect(readProviderResponse(response, AbortSignal.timeout(1000))).rejects.toMatchObject({code:"OPENAI_STREAM_PADDING"});
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("allows quoted whitespace, escaped quotes across deltas and ordinary JSON formatting", async () => {
    const value = {text:`quoted \" ${' '.repeat(300)} \\ ending`, required:true};
    const output = JSON.stringify(value,null,2);
    const frames = [...output].map(delta=>`data: ${JSON.stringify({type:"response.output_text.delta",delta})}\n\n`).join('');
    const completed = {status:'completed',output_text:output};
    await expect(readProviderResponse(streamed(frames + `data: ${JSON.stringify({type:'response.completed',response:completed})}\n\n`,64),new AbortController().signal))
      .resolves.toEqual(completed);
  });
  it("handles split UTF-8, CRLF, comments and several frames without publishing deltas", async () => {
    const events = vi.fn(async () => {});
    const value = await readProviderResponse(streamed(': ping\r\ndata: {"type":"response.output_text.delta","delta":"Grüezi Юлія"}\r\n\r\ndata: {"type":"response.completed","response":{"status":"completed","id":"resp_final","output_text":"Zürich"}}\r\n\r\n'), new AbortController().signal, events);
    expect(value).toEqual({ status: "completed", id: "resp_final", output_text: "Zürich" });
    expect(events).toHaveBeenCalledTimes(2);
    expect(events).toHaveBeenNthCalledWith(1, "response.output_text.delta", null, new TextEncoder().encode("Grüezi Юлія").byteLength);
  });
  it.each(['data: {"type":"response.output_text.delta","delta":"{}"}\n\n', 'data: [DONE]\n\n', ''])
    ("rejects EOF without a completed response", async body => {
      await expect(readProviderResponse(streamed(body), new AbortController().signal)).rejects.toMatchObject({ code: "OPENAI_STREAM_INCOMPLETE" });
    });
  it.each(["failed", "incomplete"])("retains terminal usage for %s without accepting its output", async status => {
    await expect(readProviderResponse(streamed(`data: ${JSON.stringify({ type: `response.${status}`, response: { id: "resp_bad", status, usage: { output_tokens: 20000 } } })}\n\n`), new AbortController().signal))
      .rejects.toMatchObject({ code: "OPENAI_STREAM_FAILED", response: { usage: { output_tokens: 20000 } } });
  });
  it("cancels a stalled body on lease loss", async () => {
    const cancel = vi.fn(), controller = new AbortController();
    const pending = readProviderResponse(new Response(new ReadableStream({ cancel }), { headers: { "content-type": "text/event-stream" } }), controller.signal);
    const observed = pending.catch(error => error);
    controller.abort(new Error("LEASE_LOST"));
    expect(await observed).toMatchObject({ message: "LEASE_LOST" }); expect(cancel).toHaveBeenCalledOnce();
  });
  it("bounds an unterminated event", async () => {
    await expect(readProviderResponse(streamed(`data: ${"x".repeat(2_000_001)}`, 65536), new AbortController().signal))
      .rejects.toMatchObject({ code: "OPENAI_BODY_LIMIT" });
  });
  it("parses seconds and HTTP-date Retry-After, rejecting invalid values", () => {
    expect(retryAfterMs("30")).toBe(30000);
    expect(retryAfterMs("Mon, 05 Oct 2026 12:00:30 GMT", Date.parse("2026-10-05T12:00:00Z"))).toBe(30000);
    expect(retryAfterMs("private error text")).toBe(0);
  });
  it("backs off on exhausted shared quotas using bounded reset headers",()=>{
    expect(providerBackoffMs(new Headers({"x-ratelimit-remaining-tokens":"0","x-ratelimit-reset-tokens":"1m2.5s","retry-after":"3"}))).toBe(62500);
    expect(providerBackoffMs(new Headers({"x-ratelimit-remaining-requests":"2","x-ratelimit-reset-requests":"1h"}))).toBe(0);
    expect(providerBackoffMs(new Headers({"x-ratelimit-remaining-requests":"0","x-ratelimit-reset-requests":"1h"}))).toBe(900000);
  });
});
