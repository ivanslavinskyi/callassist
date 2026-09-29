/** Opt-in, paid OpenAI probe using synthetic text only. No DB, calls or customer data. */
import "../src/config/load-env.ts";
import { classifyLiveSemantics } from "../src/voice/live-semantic-gate.ts";
import { semanticFixtures } from "../src/voice/live-semantic-fixtures.ts";
import type { OpenAILiveBridgeOptions } from "../src/voice/openai-live-bridge.ts";
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_REQUIRED");
const results: Array<Record<string, unknown>> = [];
const options = { apiKey: process.env.OPENAI_API_KEY, service: {
  recordRealtimeProviderOperation: async () => {},
  completeProviderOperation: async result => { results.push(result); }
} } as unknown as OpenAILiveBridgeOptions;
let failed = 0;
for (let index = 0; index < semanticFixtures.length; index++) {
  const fixture = semanticFixtures[index];
  const started = Date.now();
  const decision = await classifyLiveSemantics(options, { callBriefId: "synthetic", callAttemptId: "synthetic", parentOperationId: "synthetic" },
    fixture.input, new AbortController().signal);
  const valid = decision === fixture.expected && results.at(-1)?.outcome === "succeeded";
  if (!valid) failed++;
  console.log(JSON.stringify({ index, kind: fixture.input.kind, locale: fixture.input.locale, expected: fixture.expected, decision, valid, ms: Date.now() - started, status: results.at(-1)?.statusCode }));
  if (!results.at(-1)?.statusCode) { console.error("Provider unavailable; stopping probe."); break; }
}
console.log(JSON.stringify({ total: semanticFixtures.length, tested: results.length, failed }));
if (failed) process.exitCode = 1;
