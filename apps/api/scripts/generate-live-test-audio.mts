/** Creates synthetic recipient fixtures only; never reads customer recordings. */
import "../src/config/load-env.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import WebSocket from "ws";
import { LiveControlledSpeech } from "../src/voice/live-controlled-speech.ts";
const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error("OPENAI_API_KEY_REQUIRED");
const folder = resolve(process.cwd(), ".tools/synthetic-live-client");
await mkdir(folder, { recursive: true });
const phrases = ["Yes, you may record and transcribe this call.", "Yes, now is a convenient time.", "Yes, we received the application yesterday.",
  "16 September 2099 at 15:00 is available for that appointment. There is no payment or special condition.",
  "Yes, that exact appointment on 16 September 2099 at 15:00 is now booked.",
  "Yes, please go ahead and book that exact appointment at that time."];
for (const [index, text] of phrases.entries()) {
if (process.argv.includes("--appointment-only") && index < 3) continue;
const selected = process.argv.find(arg => arg.startsWith("--fixture="));
if (selected && index !== Number(selected.split("=")[1])) continue;
await new Promise<void>((resolve, reject) => {
  const socket = new WebSocket("wss://api.openai.com/v1/live/sessions", { headers: { Authorization: `Bearer ${key}` } });
  const chunks: Buffer[] = []; let input: ReturnType<typeof setInterval>; let complete = false;
  const deadline = setTimeout(() => { socket.terminate(); reject(new Error("FIXTURE_TIMEOUT")); }, 45_000);
  const send = (event: object) => socket.send(JSON.stringify(event));
  const gate = new LiveControlledSpeech(text, (audio, mark) => {
    for (const packet of audio) chunks.push(Buffer.from(packet, "base64"));
    if (mark) gate.acknowledge(mark);
  }, () => { complete = true; send({ type: "session.close" }); }, reason => { reject(new Error(reason)); socket.close(); }, async () => "different");
  socket.on("open", () => send({ type: "session.start", session: { model: "gpt-live-1", store: false,
    instructions: "This is a synthetic audio fixture. Speak only the exact text requested by the application, once, then stay silent. Never ask questions or respond on your own.",
    audio: { format: { type: "audio/pcmu", rate: 8000 }, output: { voice: "marin" } }, delegation: { type: "client" } } }));
  socket.on("message", data => {
    const event = JSON.parse(data.toString());
    if (event.type === "session.started") {
      input = setInterval(() => send({ type: "session.input_audio.append", audio: Buffer.alloc(160, 255).toString("base64") }), 20);
      send({ type: "session.instructions.append", delegation_id: null, content: `Say exactly once now: ${text}` });
    }
    if (event.type === "session.output_audio.delta") gate.audio(event.delta);
    if (event.type === "session.output_transcript.delta") gate.transcript(event.delta);
    if (event.type === "error") { reject(new Error(`FIXTURE_PROVIDER_${event.error?.code}`)); socket.close(); }
    if (event.type === "session.closed") { console.log(JSON.stringify({ fixture: index, complete, usage: event.usage })); socket.close(); }
  });
  socket.on("error", () => reject(new Error("FIXTURE_NETWORK_ERROR")));
  socket.on("close", () => {
    clearTimeout(deadline); clearInterval(input); gate.cancel();
    if (!complete) { reject(new Error("FIXTURE_INCOMPLETE")); return; }
    void writeFile(`${folder}/answer-${index}.ulaw`, Buffer.concat(chunks)).then(() => resolve(), reject);
  });
});
}
