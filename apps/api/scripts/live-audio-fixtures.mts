import { readFile, stat } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { consentFixtures } from "../src/test-helpers/live-consent-fixtures.ts";

export const syntheticAnswers = ["Yes, you may record and transcribe this call.", "Yes, now is a convenient time.", "Yes, we received the application yesterday.",
  "16 September 2099 at 15:00 is available for that appointment. There is no payment or special condition.",
  "Yes, that exact appointment on 16 September 2099 at 15:00 is now booked.",
  "Yes, please go ahead and book that exact appointment at that time."] as const;

/** Read-only preflight runs before provider sockets or calls are created. */
export async function readSyntheticAnswers(folder: string, indices: number[]) {
  const absolute = resolve(folder);
  if (!(await stat(absolute)).isDirectory()) throw new Error("FIXTURES_DIRECTORY_REQUIRED");
  return Promise.all(indices.map(async id => {
    if (!Number.isInteger(id) || id < 0 || id >= syntheticAnswers.length) throw new Error("FIXTURE_INDEX_INVALID");
    const name = `answer-${id}`;
    return readSyntheticFixture(absolute, name, syntheticAnswers[id]!, "en-GB", null);
  }));
}

/** Consent probes use the same generated manifest/checksum format as answer probes. */
export async function readSyntheticConsent(audioPath: string) {
  const absolute = resolve(audioPath), match = /^consent-(0|[1-9]\d*)\.ulaw$/.exec(basename(absolute));
  const fixture = match ? consentFixtures[Number(match[1])] : undefined;
  if (!fixture || !match) throw new Error("SYNTHETIC_CONSENT_FIXTURE_REQUIRED");
  const audio = await readSyntheticFixture(dirname(absolute), `consent-${match[1]}`, fixture.input.received, fixture.input.locale, fixture.expected);
  return { audio, locale: fixture.input.locale, expected: fixture.expected };
}

async function readSyntheticFixture(folder: string, name: string, text: string, locale: string, expected: string | null) {
  const [audio, metadata] = await Promise.all([readFile(join(folder, `${name}.ulaw`)), readFile(join(folder, `${name}.json`), "utf8")]);
  const manifest = JSON.parse(metadata);
  if (!manifest || typeof manifest !== "object" || manifest.schemaVersion !== 1 || manifest.synthetic !== true || manifest.name !== name ||
    manifest.text !== text || manifest.locale !== locale || manifest.expected !== expected ||
    manifest.mimeType !== "audio/pcmu" || manifest.sampleRate !== 8000 || manifest.channels !== 1 || manifest.bytes !== audio.length ||
    audio.length < 160 || audio.length > 120 * 8000 || manifest.sha256 !== createHash("sha256").update(audio).digest("hex")) {
    throw new Error(`SYNTHETIC_FIXTURE_PREFLIGHT_FAILED:${name}`);
  }
  return audio;
}
