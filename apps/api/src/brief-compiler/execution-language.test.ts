import { describe, expect, it, vi } from "vitest";
import { normalizeCreateCallBriefInput, type CallLocale } from "@callassist/contracts";
import { DeterministicBriefCompiler, OpenAIBriefCompiler } from "./brief-compiler";
import { verifyExecutionLanguage } from "./execution-language";

const raw = normalizeCreateCallBriefInput({ recipientName: "Иван Петров", phoneNumber: "+41710000001",
  representedPersonFirstName: "Nina", representedPersonLastName: "Keller", assistantProfileId: "anna",
  objective: "Ask whether the application arrived", context: "SOURCE PRIVATE CONTEXT", locale: "en-GB", allowedFacts: [] });
async function fixture() {
  const result = await new DeterministicBriefCompiler().compile(raw);
  return { ...result.compiledBrief!, schedulingInterpretation: { intent: "none", authorityEvidence: null, schedule: null } };
}
describe("execution language audit", () => {
  it.each(["de-CH", "de-DE", "en-GB", "en-US", "fr-CH", "it-CH", "ru-RU"] as CallLocale[])("audits every execution field in %s without raw/source-language prose", async locale => {
    const compiled = { ...await fixture(), backgroundSummary: "Approved translated context", callLocale: locale };
    const request = vi.fn(async (_body: object) => ({ output_text: '{"violations":[]}' }));
    expect(await verifyExecutionLanguage(compiled, { ...raw, locale }, request, "gpt-5.6")).toEqual([]);
    const body = request.mock.calls[0]![0] as { input: string; instructions: string };
    const data = JSON.parse(body.input);
    expect(data.callLocale).toBe(locale);
    expect(data.identityNames).toContain("Иван Петров");
    expect(data.fields).toHaveProperty("backgroundSummary");
    expect(Object.keys(data.fields).some(key => key.startsWith("orderedQuestions."))).toBe(true);
    expect(body.input).not.toContain("SOURCE PRIVATE CONTEXT");
    expect(body.input).not.toContain("sourceText");
  });
  it.each([{}, { violations: ["rawBrief"] }, { violations: "okay" }])("fails closed for malformed verdict %j", async verdict => {
    await expect(verifyExecutionLanguage(await fixture(), raw, async () => ({ output_text: JSON.stringify(verdict) }), "model")).rejects.toThrow();
  });
  it.each([false, true])("repairs mixed-language content once and accounts for audit requests (persistent=%s)", async persistent => {
    const output = await fixture();
    let compilations = 0, audits = 0;
    const fetchImplementation = vi.fn<typeof fetch>(async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("moderations")) return new Response(JSON.stringify({ results: [{ flagged: false }] }));
      if (body.text.format.name === "execution_language_audit") {
        audits++;
        return new Response(JSON.stringify({ output_text: JSON.stringify({ violations: audits === 1 || persistent ? ["backgroundSummary"] : [] }), usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } }));
      }
      compilations++;
      return new Response(JSON.stringify({ id: `plan-${compilations}`, output_text: JSON.stringify({ ...output,
        backgroundSummary: compilations === 1 || persistent ? "Уточнить получение заявления" : "Ask whether the application arrived" }) }));
    });
    const beforeProviderRequest = vi.fn(async () => true), afterProviderRequest = vi.fn(async () => undefined);
    const result = await new OpenAIBriefCompiler({ apiKey: "test", fetchImplementation }).compile(raw, 1, { beforeProviderRequest, afterProviderRequest });
    expect(result.policyDecision.status).toBe(persistent ? "blocked" : "ready_for_review");
    expect(compilations).toBe(2); expect(audits).toBe(2);
    expect(beforeProviderRequest).toHaveBeenCalledTimes(6); expect(afterProviderRequest).toHaveBeenCalledTimes(6);
    const repair = JSON.parse(String(fetchImplementation.mock.calls[3]?.[1]?.body));
    expect(repair.input[0].content).toContain("Language mismatch at backgroundSummary");
  });
});
