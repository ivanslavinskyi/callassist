/** Bounded semantic evaluation with fictional transcripts. No calls or application records. */
import "../src/config/load-env";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createTextProcessorFromEnv } from "../src/text-processing/text-processor";

if (!process.argv.includes("--run-provider")) throw new Error("Pass --run-provider to run these six fictional provider requests");
const directory = resolve(process.cwd(), "../../.tools/general-call-evaluation");
await mkdir(directory, { recursive: true });
const processor = createTextProcessorFromEnv({ ...process.env, TEXT_PROCESSOR_DRIVER: "openai" });
const fixtures = [
  { id: "negative-answer", taskType: "receipt_confirmation", objective: "Find out whether the form arrived", check: "Receipt status",
    expected: "A clear negative answer resolves the receipt inquiry; no invented receipt or follow-up.",
    lines: [["assistant", "Has Nina's form arrived?"], ["recipient", "No, it has not arrived."], ["assistant", "Thank you for checking."]] },
  { id: "message-relay", taskType: "message_delivery", objective: "Tell Alex that Nina will call again after work", check: "Whether the message was delivered",
    expected: "Message delivered and acknowledged; no appointment or additional promise.",
    lines: [["assistant", "Nina asked me to tell you that she will call you after work."], ["recipient", "Understood, thank you."]] },
  { id: "partial-information", taskType: "information_request", objective: "Find opening hours and required documents", check: "Required documents",
    expected: "Hours known, documents unknown; the uncertainty remains visible.",
    lines: [["assistant", "When are you open, and which documents are needed?"], ["recipient", "We open at 09:00. I do not know which documents are needed."]] },
  { id: "conditional-status", taskType: "status_check", objective: "Find out whether the application is complete", check: "What is still required",
    expected: "Conditional completion; Nina must send the missing signature. Do not claim completion.",
    lines: [["assistant", "Is Nina's application complete?"], ["recipient", "Only once Nina sends the missing signature. Until then it remains incomplete."]] },
  { id: "contradictory-answer", taskType: "information_request", objective: "Confirm whether delivery is available", check: "Whether delivery is available",
    expected: "Contradictory evidence stays uncertain, never unconditional availability.",
    lines: [["assistant", "Is delivery available?"], ["recipient", "Yes."], ["recipient", "Actually, I am not sure. The information I have conflicts."]] },
  { id: "recipient-stops", taskType: "information_request", objective: "Ask for the status of Nina's application", check: "Application status",
    expected: "Recipient refused to continue; application status remains unknown, no implied success or callback.",
    lines: [["assistant", "Could you tell me the status of Nina's application?"], ["recipient", "I do not want to continue. Please end this call."]] }
] as const;
const results: unknown[] = [];
for (const fixture of fixtures) {
  let usage: unknown;
  try {
    const output = await processor.process({ kind: "call_summary", targetLanguage: "ru",
      context: { objective: fixture.objective, taskType: fixture.taskType, recipient: "Alex Example", representedPerson: "Nina Example" },
      checks: [{ id: "goal", text: fixture.objective }, { id: "question.0", text: fixture.check }],
      segments: fixture.lines.map(([role, text], index) => ({ id: `segment.${index}`, role, text, startSeconds: null, endSeconds: null }))
    }, { maxProviderRequests: 1, afterProviderRequest: async result => { usage = result; } });
    results.push({ id: fixture.id, expected: fixture.expected, output, usage });
    console.log(`${fixture.id}: schema and evidence passed; semantic review required`);
  } catch (error) {
    results.push({ id: fixture.id, error: error instanceof Error ? error.message : "failed", usage });
    process.exitCode = 1;
  }
  await writeFile(resolve(directory, "results.json"), JSON.stringify(results, null, 2));
}
