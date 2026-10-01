import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consentFixtures } from "../src/test-helpers/live-consent-fixtures.ts";
import { readSyntheticAnswers, readSyntheticConsent, syntheticAnswers } from "./live-audio-fixtures.mts";

let folder: string;
const audio = Buffer.alloc(160, 255);
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), "callassist-live-fixtures-")); });
afterEach(async () => {
  // Only remove this test's own freshly created directory, never a caller path.
  if (dirname(resolve(folder)) !== resolve(tmpdir()) || !/^callassist-live-fixtures-[a-zA-Z0-9]+$/.test(basename(folder))) throw new Error("FIXTURE_CLEANUP_PATH_INVALID");
  await rm(folder, { recursive: true, force: true });
});
async function fixture(name = "consent-0", overrides: Record<string, unknown> = {}) {
  const consent = consentFixtures[0]!;
  await writeFile(join(folder, `${name}.ulaw`), audio);
  await writeFile(join(folder, `${name}.json`), JSON.stringify({ schemaVersion: 1, synthetic: true, name,
    text: consent.input.received, locale: consent.input.locale, expected: consent.expected,
    mimeType: "audio/pcmu", sampleRate: 8000, channels: 1, bytes: audio.length,
    sha256: createHash("sha256").update(audio).digest("hex"), ...overrides }));
  return join(folder, `${name}.ulaw`);
}

describe("synthetic audio preflight without providers", () => {
  it("accepts the known consent corpus and returns its locale/expectation", async () => {
    expect(await readSyntheticConsent(await fixture())).toEqual({ audio, locale: "ru-RU", expected: "affirmative" });
  });
  it.each([
    { synthetic: false }, { text: "Unreviewed audio description" }, { locale: "de-CH" }, { expected: "negative" },
    { sha256: "0".repeat(64) }, { bytes: 161 }, { sampleRate: 16000 }, { mimeType: "audio/wav" }
  ])("rejects mismatched provenance %j before a probe can dispatch", async overrides => {
    await expect(readSyntheticConsent(await fixture("consent-0", overrides))).rejects.toThrow("SYNTHETIC_FIXTURE_PREFLIGHT_FAILED");
  });
  it("rejects arbitrary names, unknown corpus entries and missing manifests", async () => {
    await expect(readSyntheticConsent(await fixture("customer-audio"))).rejects.toThrow("SYNTHETIC_CONSENT_FIXTURE_REQUIRED");
    await expect(readSyntheticConsent(await fixture("consent-999"))).rejects.toThrow("SYNTHETIC_CONSENT_FIXTURE_REQUIRED");
    await writeFile(join(folder, "consent-1.ulaw"), audio);
    await expect(readSyntheticConsent(join(folder, "consent-1.ulaw"))).rejects.toThrow();
  });
  it("retains the generated answer format used by managed probes", async () => {
    await fixture("answer-0", { text: syntheticAnswers[0], locale: "en-GB", expected: null });
    expect(await readSyntheticAnswers(folder, [0])).toEqual([audio]);
  });
});
