/** Paid opt-in probe. Synthetic dialogue only; no database, recordings or calls. */
import "../src/config/load-env.ts";
import { OpenAITextProcessor } from "../src/text-processing/openai-text-processor.ts";
import type { TextProcessingInput } from "../src/text-processing/text-processor.ts";
import type { TextLanguage } from "@callassist/contracts";

const apiKey = process.env.OPENAI_API_KEY;
if (!process.argv.includes("--run-provider")) throw new Error("RUN_PROVIDER_OPT_IN_REQUIRED");
if (!apiKey) throw new Error("OPENAI_API_KEY_REQUIRED");
let failed = 0;
const summaryProcessor = new OpenAITextProcessor({ apiKey, model: process.env.TEXT_PROCESSOR_MODEL ?? process.env.OPENAI_BRIEF_COMPILER_MODEL });
const input: Extract<TextProcessingInput, { kind: "call_summary" }> = {
  kind: "call_summary", targetLanguage: "en", assessmentMode: "evaluate",
  applicationFacts: { transcriptPersisted: true, resultHandling: "capture_in_callassist" },
  context: { objective: "Find out the library opening day.", taskType: "information_request", recipient: "Library", representedPerson: "Test Caller" },
  checks: [{ id: "goal", text: "Find out the library opening day." }, { id: "criterion.0", text: "The opening day is known." },
    { id: "criterion.1", text: "Answers are saved in SHPROHLI." }],
  segments: [
    { id: "s0", role: "assistant", text: "On which day does the library open?", startSeconds: 0, endSeconds: 2 },
    { id: "s1", role: "recipient", text: "We open on Tuesday.", startSeconds: 3, endSeconds: 5 },
    { id: "s2", role: "recipient", text: "Sam, please put your toys away. Sorry, I am listening.", startSeconds: 6, endSeconds: 8 },
    { id: "s3", role: "assistant", text: "The library opens on Tuesday. Thank you and goodbye.", startSeconds: 9, endSeconds: 12 }
  ]
};
for (const targetLanguage of (process.argv.includes("--external-only") ? [] : ["en", "de", "fr", "it", "ru", "uk", "es"]) as TextLanguage[]) {
  try {
    const result = await summaryProcessor.process({ ...input, targetLanguage });
    const valid = "assessment" in result && result.assessment?.goal.status === "achieved" &&
      result.assessment.criteria.every(c => c.status === "achieved") && !result.unresolved.length;
    if (!valid) failed++;
    console.log(JSON.stringify({ probe: "summary", targetLanguage, valid, result }));
  } catch (error) { failed++; console.log(JSON.stringify({ probe: "summary", targetLanguage, error: error instanceof Error ? error.message : "unknown", cause: error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined })); }
}
const external = await summaryProcessor.process({ ...input, applicationFacts: { transcriptPersisted: true, resultHandling: "request_external_delivery" },
  checks: [...input.checks.slice(0, 2), { id: "criterion.1", text: "The library has sent the opening hours by email to the caller." }] });
const externalValid = "assessment" in external && external.assessment?.criteria[1]?.status !== "achieved" && external.assessment?.goal.status !== "achieved";
if (!externalValid) failed++;
console.log(JSON.stringify({ probe: "external-delivery-not-proved-by-internal-storage", valid: externalValid, result: external }));
console.log(JSON.stringify({ failed }));
if (failed) process.exitCode = 1;
