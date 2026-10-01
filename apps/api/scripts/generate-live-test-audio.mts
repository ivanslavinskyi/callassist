/** Paid, explicitly opted-in synthesis of fixed synthetic recipient fixtures. */
import "../src/config/load-env.ts";
import { mkdir, access, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { renderSpeech } from "../src/voice/rendered-speech.ts";
import { consentFixtures } from "../src/test-helpers/live-consent-fixtures.ts";
import { syntheticAnswers } from "./live-audio-fixtures.mts";

const args = process.argv.slice(2);
const folderArg = args.find(arg => arg.startsWith("--fixtures-dir="))?.slice("--fixtures-dir=".length);
if (!args.includes("--run-provider") || !folderArg) throw new Error("Use --run-provider --fixtures-dir=<explicit output directory> [--fixture=N | --consent-fixture=N | --appointment-only]");
if (args.some(arg => !["--run-provider", "--appointment-only"].includes(arg) && !/^--(fixtures-dir|fixture|consent-fixture)=.+$/.test(arg))) throw new Error("UNKNOWN_FIXTURE_OPTION");
const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error("OPENAI_API_KEY_REQUIRED");
const folder = resolve(folderArg);
const selected = args.find(arg => arg.startsWith("--fixture="))?.slice("--fixture=".length);
const consent = args.find(arg => arg.startsWith("--consent-fixture="))?.slice("--consent-fixture=".length);
if ([selected !== undefined, consent !== undefined, args.includes("--appointment-only")].filter(Boolean).length > 1) throw new Error("SELECT_ONE_FIXTURE_MODE");
function index(value: string, length: number) {
  if (!/^\d+$/.test(value) || Number(value) >= length) throw new Error("FIXTURE_INDEX_INVALID");
  return Number(value);
}
const fixtures = consent !== undefined ? (() => {
  const id = index(consent, consentFixtures.length), fixture = consentFixtures[id]!;
  return [{ name: `consent-${id}`, text: fixture.input.received, locale: fixture.input.locale, expected: fixture.expected }];
})() : syntheticAnswers.flatMap((text, id) => selected !== undefined && id !== index(selected, syntheticAnswers.length) || args.includes("--appointment-only") && id < 3
  ? [] : [{ name: `answer-${id}`, text, locale: "en-GB", expected: null }]);
await mkdir(folder, { recursive: true });
// Reject existing destinations before making any paid request.
for (const fixture of fixtures) for (const ext of ["ulaw", "json"]) {
  if (await access(join(folder, `${fixture.name}.${ext}`)).then(() => true, () => false)) throw new Error(`FIXTURE_ALREADY_EXISTS:${fixture.name}.${ext}`);
}
for (const fixture of fixtures) {
  const rendered = await renderSpeech({ apiKey: key, text: fixture.text, locale: fixture.locale, voice: "alloy" });
  const audio = Buffer.concat(rendered.frames.map(frame => Buffer.from(frame, "base64")));
  await writeFile(join(folder, `${fixture.name}.ulaw`), audio, { flag: "wx" });
  await writeFile(join(folder, `${fixture.name}.json`), JSON.stringify({ schemaVersion: 1, synthetic: true, name: fixture.name,
    text: fixture.text, locale: fixture.locale, expected: fixture.expected, sha256: createHash("sha256").update(audio).digest("hex"),
    mimeType: "audio/pcmu", sampleRate: 8000, channels: 1, bytes: audio.length, durationMs: rendered.durationMs,
    model: rendered.model, providerRequestId: rendered.providerRequestId }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ fixture: fixture.name, bytes: audio.length, durationMs: rendered.durationMs, model: rendered.model }));
}
