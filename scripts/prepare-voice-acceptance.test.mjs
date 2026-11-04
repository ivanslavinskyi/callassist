import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepareVoiceAcceptance } from "./prepare-voice-acceptance.mjs";

const catalog = JSON.parse(await readFile(new URL("../docs/voice-acceptance-scenarios-2026-11-02.json", import.meta.url), "utf8"));
const now = new Date("2026-11-02T10:00:00Z");
const prepare = (data = catalog, date = "2026-11-10") => prepareVoiceAcceptance(data, date, now);

test("prepares complete, counterbalanced pairs without declaring execution, approval or success", () => {
  const packet = prepare();
  assert.equal(packet.totalPairs, 85);
  assert.equal(packet.totalPlannedAttempts, 170);
  assert.equal(new Set(packet.runs.map(r => r.id)).size, 170);
  assert.equal(packet.decision, "not_evaluated");
  assert.equal(packet.externalExecutionAuthorized, false);
  assert.ok(Object.values(packet.requiredBeforeExternalExecution).every(v => v === null));
  for (const run of packet.runs) {
    const pair = packet.runs.filter(r => r.pairId === run.pairId);
    assert.deepEqual(new Set(pair.map(r => r.arm)), new Set(["baseline", "candidate"]));
    assert.deepEqual(pair.map(r => r.order), [1, 2]);
    assert.equal(run.status, "not_run");
    assert.equal(run.actualGoal, null);
    assert.ok(Object.values(run.metrics).every(v => v === null));
    assert.ok(Object.values(run.checks).every(v => v === "not_reviewed"));
  }
  assert.equal(packet.runs[0].arm, "baseline");
  assert.equal(packet.runs[2].arm, "candidate");
});

test("keeps unknown facts empty, refusal explicit and failed tasks valid test expectations", () => {
  const packet = prepare();
  assert.deepEqual(packet.cohorts.find(c => c.id === "S03-de-hybrid").allowedFacts, []);
  assert.deepEqual(packet.cohorts.find(c => c.id === "S04-de-hybrid").allowedFacts, ["Do not share the date of birth.", "Previous visit history is unknown."]);
  assert.equal(packet.cohorts.find(c => c.id === "S04-de-hybrid").expectedGoal, "not_achieved");
  assert.equal(packet.cohorts.find(c => c.id === "S08-de-hybrid").expectedGoal, "no_task");
});

test("foreign timezone and confirm-existing variants cannot silently reuse booking authority", () => {
  const packet = prepare();
  const foreign = packet.cohorts.find(c => c.variant === "foreign_zone");
  assert.equal(foreign.timeZone, "America/New_York");
  assert.ok(foreign.objective.includes("America/New_York"));
  assert.ok(!foreign.objective.includes("Europe/Zurich"));
  const existing = packet.cohorts.find(c => c.variant === "confirm_existing");
  assert.equal(existing.initialLedgerEntries, 1);
  assert.equal(existing.expectedFinalLedgerEntries, 1);
  assert.equal(existing.expectedNewLedgerEntries, 0);
  assert.ok(existing.objective.startsWith("Confirm attendance at the existing"));
  assert.ok(!existing.actorLines.some(line => line.includes("anbieten")));
});

test("uses current future dates and synthetic parties only, without a usable phone target", () => {
  const before = structuredClone(catalog);
  const packet = prepare();
  assert.deepEqual(catalog, before);
  assert.ok(!JSON.stringify(packet).includes("{{DATE}}"));
  for (const cohort of packet.cohorts) {
    assert.equal(cohort.targetPhone, null);
    assert.ok(cohort.objective.includes("2026-11-10"));
    assert.ok(cohort.context.includes("Never contact a real clinic"));
  }
});

test("rejects stale, same-day, invalid or distant dates, including Zurich midnight", () => {
  for (const date of ["2026-11-01", "2026-11-02", "2026-11-31", "2027-05-01", "tomorrow", "2026-1-3"]) {
    assert.throws(() => prepare(catalog, date), /valid appointment date/);
  }
  assert.throws(() => prepareVoiceAcceptance(catalog, "2026-11-03", new Date("2026-11-02T23:30:00Z")), /valid appointment date/);
});

test("rejects phone targets, duplicate IDs, absent actor scripts and too few pairs", () => {
  const edits = [
    c => { c.targetPhone = "+41000000000"; },
    c => { c.scenarios.push(c.scenarios[0]); },
    c => { c.cohorts.push(c.cohorts[0]); },
    c => { c.cohorts[0].pairs = 1; },
    c => { c.cohorts[0].locale = "fr-CH"; },
    c => { c.cohorts[0].variant = "confirm_existing"; },
    c => { c.cohorts[0].scenarioId = "missing"; },
    c => { delete c.scenarios[0].de; }
  ];
  for (const edit of edits) {
    const changed = structuredClone(catalog); edit(changed);
    assert.throws(() => prepare(changed));
  }
});

test("CLI has no start option and refuses it before creating any file", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./prepare-voice-acceptance.mjs", import.meta.url)), "--start"], { encoding: "utf8", windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown option.*start/);
});
