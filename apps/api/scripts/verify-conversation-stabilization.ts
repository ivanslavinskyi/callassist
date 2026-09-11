/** Bounded provider evaluation with fictional text only; no telephony or app records. */
import "../src/config/load-env";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import WebSocket from "ws";
import { createTextProcessorFromEnv } from "../src/text-processing/text-processor";
import { interruptedClosingInstructions, interruptedClosingTool, parseClosingAction } from "../src/realtime/interrupted-closing";

if (!process.argv.includes("--run-provider")) throw new Error("Use --run-provider for this fictional provider evaluation");
const directory = resolve(process.cwd(), "../../.tools/stabilization-evaluation");
await mkdir(directory, { recursive: true });
const processor = createTextProcessorFromEnv({ ...process.env, TEXT_PROCESSOR_DRIVER: "openai" });
const results: unknown[] = [];
const summaryCases = [
  { id: "confirmed", transcript: "Assistant: Nina Example would like to meet you at home. Is Monday, 14 September 2026 at 10:00 Swiss local time suitable?\nRecipient: Yes, I confirm Monday, 14 September 2026 at 10:00 at my home. Nina knows the address.\nAssistant: Thank you.", expected: "confirmed" },
  { id: "conditional", transcript: "Assistant: Can you meet Nina on Monday?\nRecipient: Only if I finish work early. It is not confirmed; Nina should call me again on Sunday.", expected: "conditional" },
  { id: "refusal", transcript: "Assistant: Can you meet Nina?\nRecipient: No, I do not want a meeting. Please do not call again.", expected: "refused" }
];
for (const fixture of summaryCases) {
  let usage: unknown;
  try {
    const output = await processor.process({ kind: "call_summary", targetLanguage: "ru",
      context: { objective: "Arrange one meeting for Nina Example", taskType: "appointment_coordination", recipient: "Alex Example", representedPerson: "Nina Example" },
      checks: [{ id: "goal", text: "Is the meeting confirmed?" }, { id: "question.0", text: "When and where is the meeting?" }, { id: "criterion.0", text: "Explicit recipient confirmation of the arrangement" }],
      segments: fixture.transcript.split("\n").map((text, index) => ({ id: `segment.${index}`, role: text.startsWith("Recipient:") ? "recipient" : "assistant", text: text.replace(/^(Assistant|Recipient): /, ""), startSeconds: null, endSeconds: null }))
    }, { maxProviderRequests: 1, afterProviderRequest: async value => { usage = value; } });
    results.push({ id: fixture.id, expected: fixture.expected, output, usage });
    console.log(`${fixture.id}: schema and evidence passed`);
  } catch (error) { results.push({ id: fixture.id, error: error instanceof Error ? error.message : "failed", usage }); process.exitCode = 1; }
  await writeFile(resolve(directory, "results.json"), JSON.stringify(results, null, 2));
}

const routeCases = [
  ["Спасибо, до свидания!", "end"],
  ["Спасибо, а почему в пятницу нельзя?", "answer"],
  ["Подождите, я сейчас посмотрю…", "wait"],
  ["Он сказал мне до свидания, но я ещё хотела спросить про адрес.", "answer"],
  ["Нет, я не хочу продолжать. Закончим.", "end"]
] as const;
for (const [utterance, expected] of routeCases) {
  const result = await new Promise<Record<string, unknown>>(resolveResult => {
    const socket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1")}`, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
    const timer = setTimeout(() => { socket.close(); resolveResult({ expected, error: "timeout" }); }, 25_000);
    const finish = (value: Record<string, unknown>) => { clearTimeout(timer); socket.close(); resolveResult(value); };
    socket.on("error", () => finish({ expected, error: "connection_failed" }));
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "response.create", response: {
        conversation: "none", output_modalities: ["text"], max_output_tokens: 128,
        tools: [interruptedClosingTool], tool_choice: { type: "function", name: interruptedClosingTool.name },
        instructions: interruptedClosingInstructions,
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: "Мы подтвердили встречу. Спасибо." }] },
          { type: "message", role: "assistant", content: [{ type: "output_text", text: "Спасибо за ваше время. До свидания." }] },
          { type: "message", role: "user", content: [{ type: "input_text", text: utterance }] }
        ]
      } }));
    });
    socket.on("message", raw => {
      const event = JSON.parse(raw.toString());
      if (event.type === "error") finish({ expected, error: event.error?.code ?? "provider_error" });
      if (event.type === "response.done") {
        const action = parseClosingAction(event.response?.output);
        finish({ expected, action, passed: action === expected, usage: event.response?.usage });
      }
    });
  });
  results.push({ id: "closing-route", ...result });
  console.log(`closing-route ${expected}: ${result.passed ? "passed" : "FAILED"}`);
  if (!result.passed) process.exitCode = 1;
  await writeFile(resolve(directory, "results.json"), JSON.stringify(results, null, 2));
}
