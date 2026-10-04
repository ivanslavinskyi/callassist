import { createServer } from "node:http";
import { channel } from "node:diagnostics_channel";
import { afterEach, expect, it, vi } from "vitest";
import { preparationTransportDiagnosticsSchema } from "@callassist/contracts";
import { PreparationRequestDiagnostics } from "./request-diagnostics";

afterEach(() => vi.useRealTimers());

it("observes real concurrent Node fetch requests without collecting request or response content", async () => {
  const server = createServer((request, response) => {
    request.resume();
    const slow = request.url === "/slow";
    setTimeout(() => {
      response.writeHead(200, { "openai-processing-ms": slow ? "72.5" : "20", "x-ratelimit-remaining-tokens": "1234",
        "x-private": "must-not-be-collected" });
      response.flushHeaders();
      setTimeout(() => response.end('{"private":"must-not-be-collected"}'), 20);
    }, slow ? 80 : 25);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    const collect = async (path: string) => {
      const diagnostics = new PreparationRequestDiagnostics(7, 1000, 2);
      const response = await diagnostics.run(() => fetch(`http://127.0.0.1:${address.port}/${path}`, {
        method: "POST", body: "{}", headers: { Authorization: "Bearer must-not-be-collected" }
      }));
      diagnostics.headers(response); diagnostics.bodyStarted();
      await response.json();
      return diagnostics.finish();
    };
    const [slow, fast] = await Promise.all([collect("slow"), collect("fast")]);
    for (const data of [slow, fast]) {
      expect(preparationTransportDiagnosticsSchema.safeParse(data).success).toBe(true);
      expect(data.requestCreatedMs).not.toBeNull();
      expect(data.socketWriteMs).not.toBeNull();
      expect(data.requestBodySentMs).not.toBeNull();
      expect(data.socketWriteMs!).toBeGreaterThanOrEqual(data.requestCreatedMs!);
      expect(data.requestBodySentMs!).toBeGreaterThanOrEqual(data.socketWriteMs!);
      expect(data.responseHeadersMs!).toBeGreaterThanOrEqual(data.requestBodySentMs!);
      expect(data.bodyReadMs).not.toBeNull();
      expect(data.bodyReadMs).toBeGreaterThanOrEqual(0);
      expect(data.remainingTokens).toBe(1234);
      expect(JSON.stringify(data)).not.toMatch(/must-not-be-collected|Authorization|127\.0\.0\.1|private/);
    }
    expect(slow.providerProcessingMs).toBe(72.5);
    expect(fast.providerProcessingMs).toBe(20);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

it("ignores unscoped traffic and late events after timeout, and keeps concurrent owners separate", () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const first = new PreparationRequestDiagnostics(0, 1000, 5);
  const second = new PreparationRequestDiagnostics(0, 1000, 5);
  const requestA = {}, requestB = {}, unrelated = {};
  channel("undici:request:create").publish({ request: unrelated });
  first.run(() => channel("undici:request:create").publish({ request: requestA }));
  second.run(() => channel("undici:request:create").publish({ request: requestB }));
  vi.setSystemTime(100);
  channel("undici:client:sendHeaders").publish({ request: requestB });
  channel("undici:client:sendHeaders").publish({ request: unrelated });
  first.failed({ cause: { code: "ECONNRESET", message: "private text" } });
  const stopped = first.finish();
  vi.setSystemTime(500);
  channel("undici:client:sendHeaders").publish({ request: requestA });
  expect(first.finish()).toEqual(stopped);
  expect(stopped).toMatchObject({ socketWriteMs: null, failurePhase: "before_headers", networkErrorCode: "ECONNRESET" });
  expect(second.finish().socketWriteMs).toBe(100);
});

it("rejects malformed optional headers and records only allowlisted error codes", () => {
  const diagnostics = new PreparationRequestDiagnostics(1, 1000, 4);
  diagnostics.headers(new Response("{}", { headers: {
    "openai-processing-ms": "private-token", "x-ratelimit-remaining-requests": "-1",
    "x-ratelimit-remaining-tokens": "1e100"
  } }));
  diagnostics.failed({ cause: { code: "private-token", message: "sensitive plan" } });
  const result = diagnostics.finish();
  expect(result).toMatchObject({ providerProcessingMs: null, remainingRequests: null, remainingTokens: null,
    requestCreatedMs: null, socketWriteMs: null, failurePhase: "response_body", networkErrorCode: "OTHER" });
  expect(JSON.stringify(result)).not.toMatch(/private-token|sensitive plan/);
});
