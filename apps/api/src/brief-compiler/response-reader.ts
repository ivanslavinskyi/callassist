/** A completed Responses object is the only publishable stream result. */
export class ResponseReadError extends Error {
  constructor(readonly code: "OPENAI_BODY_LIMIT" | "OPENAI_STREAM_INCOMPLETE" | "OPENAI_STREAM_FAILED" | "OPENAI_STREAM_INVALID" | "OPENAI_STREAM_PADDING",
    readonly response: Record<string, unknown> | null = null) { super(code); }
}
export function retryAfterMs(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const seconds = Number(value);
  const duration = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(duration) ? Math.min(86_400_000, Math.max(0, Math.ceil(duration))) : 0;
}
/** Standard/Fast and every process share provider reset backoff. Never persist raw headers. */
export function providerBackoffMs(headers: Headers, now = Date.now()): number {
  let delay = retryAfterMs(headers.get("retry-after"), now);
  for (const resource of ["requests", "tokens"]) {
    if (headers.get(`x-ratelimit-remaining-${resource}`) !== "0") continue;
    const reset = headers.get(`x-ratelimit-reset-${resource}`) ?? "";
    if (!/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(reset)) continue;
    const milliseconds = [...reset.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)].reduce((sum, match) =>
      sum + Number(match[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2]!] ?? 0), 0);
    delay = Math.max(delay, milliseconds);
  }
  return Math.min(900000, Math.ceil(delay));
}
export async function readProviderResponse(response: Response, signal: AbortSignal,
  event?: (type: string, response: Record<string, unknown> | null, outputBytes: number) => Promise<void>): Promise<unknown> {
  if (!response.body) throw new ResponseReadError("OPENAI_STREAM_INCOMPLETE");
  const reader = response.body.getReader();
  const stream = response.headers.get("content-type")?.toLowerCase().includes("text/event-stream");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, buffer = "", data: string[] = [], eventBytes = 0;
  let terminal: Record<string, unknown> | null = null;
  // Structured output can degenerate into endless JSON whitespace while the
  // connection remains healthy. Preserve whitespace inside strings verbatim;
  // bound only consecutive formatting outside them, across SSE delta boundaries.
  let inString = false, escaped = false, padding = 0;
  const checkJsonProgress = (delta: string) => {
    for (const character of delta) {
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      if (character === ' ' || character === '\n' || character === '\r' || character === '\t') {
        if (++padding > 256) throw new ResponseReadError("OPENAI_STREAM_PADDING");
      } else padding = 0;
    }
  };
  const abort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  const dispatch = async () => {
    if (!data.length) return;
    const text = data.join("\n"); data = []; eventBytes = 0;
    if (text === "[DONE]") return;
    let value: Record<string, unknown>;
    try { value = JSON.parse(text); } catch { throw new ResponseReadError("OPENAI_STREAM_INVALID"); }
    if (!value || typeof value !== "object" || typeof value.type !== "string") throw new ResponseReadError("OPENAI_STREAM_INVALID");
    const payload = value.response && typeof value.response === "object" && !Array.isArray(value.response)
      ? value.response as Record<string, unknown> : null;
    const outputBytes = value.type === "response.output_text.delta" && typeof value.delta === "string"
      ? new TextEncoder().encode(value.delta).byteLength : 0;
    await event?.(value.type, payload, outputBytes);
    if (outputBytes) checkJsonProgress(value.delta as string);
    if (value.type === "response.completed") {
      if (!payload || payload.status !== "completed") throw new ResponseReadError("OPENAI_STREAM_INVALID", payload);
      terminal = payload;
    } else if (["response.failed", "response.incomplete", "error"].includes(value.type)) {
      throw new ResponseReadError("OPENAI_STREAM_FAILED", payload);
    }
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) { buffer += decoder.decode(); break; }
      bytes += chunk.value.byteLength;
      if (bytes > 8_000_000) throw new ResponseReadError("OPENAI_BODY_LIMIT");
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 2_000_000) throw new ResponseReadError("OPENAI_BODY_LIMIT");
      if (!stream) continue;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, ""); buffer = buffer.slice(newline + 1);
        if (!line) await dispatch();
        else if (line.startsWith("data:")) {
          const field = line.slice(5).replace(/^ /, ""); eventBytes += field.length;
          if (eventBytes > 2_000_000) throw new ResponseReadError("OPENAI_BODY_LIMIT");
          data.push(field);
        }
        if (terminal) return terminal;
      }
    }
    if (stream) {
      // A final frame without a blank separator is legal at EOF.
      if (buffer.startsWith("data:")) data.push(buffer.slice(5).replace(/^ /, "").replace(/\r$/, ""));
      await dispatch();
      if (!terminal) throw new ResponseReadError("OPENAI_STREAM_INCOMPLETE");
      return terminal;
    }
    return JSON.parse(buffer);
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
