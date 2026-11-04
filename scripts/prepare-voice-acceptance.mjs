import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

// Offline worksheet only. No environment loading, API, DB, provider or dialling imports.
export function prepareVoiceAcceptance(catalog, appointmentDate, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const date = new Date(`${appointmentDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate ?? "") ||
      !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== appointmentDate ||
      appointmentDate <= today || date.getTime() - Date.parse(`${today}T00:00:00Z`) > 60 * 86400000) {
    throw new Error("Choose a valid appointment date after today and within 60 days (Europe/Zurich)");
  }
  if (catalog.version !== 1 || catalog.syntheticOnly !== true || catalog.targetPhone !== null ||
      !catalog.scenarios?.length || !catalog.cohorts?.length) throw new Error("Expected an offline synthetic catalogue without a phone number");
  const scenarios = new Map(catalog.scenarios.map(s => [s.id, s]));
  if (scenarios.size !== catalog.scenarios.length || new Set(catalog.cohorts.map(c => c.id)).size !== catalog.cohorts.length) {
    throw new Error("Duplicate scenario or cohort ID");
  }
  const fill = text => text.replaceAll("{{DATE}}", appointmentDate);
  const runs = [];
  const cohorts = catalog.cohorts.map(cohort => {
    const scenario = scenarios.get(cohort.scenarioId);
    const actorLines = scenario?.[cohort.locale === "de-CH" ? "de" : "ru"];
    if (!scenario || !actorLines?.length || !["de-CH", "ru-RU"].includes(cohort.locale) ||
        !["semantic_native", "hybrid_deterministic_v1"].includes(cohort.consentMode) ||
        !["standard", "foreign_zone", "confirm_existing"].includes(cohort.variant) ||
        (cohort.variant !== "standard" && scenario.id !== "S02") ||
        !Number.isSafeInteger(cohort.pairs) || cohort.pairs < 5 || cohort.pairs > 10) {
      throw new Error(`Invalid acceptance cohort: ${cohort.id}`);
    }
    let objective = fill(scenario.objective);
    let lines = actorLines.map(fill);
    let timeZone = catalog.defaultTimeZone;
    let initialLedgerEntries = 0;
    let expectedNewLedgerEntries = scenario.ledger;
    let checks = [...scenario.checks];
    if (cohort.variant === "foreign_zone") {
      timeZone = "America/New_York";
      objective = objective.replace("Europe/Zurich", timeZone);
      lines.splice(1, 0, "Alle Uhrzeiten in diesem Test beziehen sich auf die Ortszeit in New York.");
      checks = ["09:45 остаётся временем New York; нет скрытого перевода в Zurich, IANA не читается как часть времени.", ...checks.slice(0, 2)];
    }
    if (cohort.variant === "confirm_existing") {
      objective = `Confirm attendance at the existing simulated check-up on ${appointmentDate} at 09:45 Europe/Zurich. Do not arrange or move any appointment.`;
      initialLedgerEntries = 1;
      expectedNewLedgerEntries = 0;
      lines = [lines[0], `Der Testtermin am ${appointmentDate} um 09:45 besteht bereits. Möchten Sie die Teilnahme bestätigen?`,
        "Ja, die Teilnahme an diesem bestehenden Testtermin ist bestätigt. Es wurde kein neuer Termin angelegt."];
      checks = ["Только confirm_existing; исходная одна запись остаётся одной, новых нет.",
        "Дата и 09:45 сохранены, IANA не добавляется к произносимому времени.",
        "Явное subsequent confirmation; нет переноса или замены."];
    }
    for (let pair = 1; pair <= cohort.pairs; pair++) {
      const pairId = `${cohort.id}-${pair}`;
      // Counterbalance provider/load and actor-learning drift. Pair 1 is a smoke subset.
      const order = pair % 2 ? ["baseline", "candidate"] : ["candidate", "baseline"];
      for (const [index, arm] of order.entries()) runs.push({
        id: `${pairId}-${arm}`, pairId, cohortId: cohort.id, arm, order: index + 1,
        status: "not_run", actualGoal: null, reviewer: null,
        buildIdentity: null, runtimeDescriptor: null, approvalSnapshotHash: null,
        callId: null, attemptId: null,
        evidence: { telemetryExport: null, postConsentAudio: null, observerNotes: null },
        actualLedgerEntries: null, newLedgerEntries: null,
        checks: { consentAndAuthority: "not_reviewed", facts: "not_reviewed",
          spokenContent: "not_reviewed", goalAssessment: "not_reviewed",
          interruptionAndClosing: "not_reviewed", runtimeHealth: "not_reviewed", playbackEvidence: "not_reviewed" },
        metrics: { replyLatencyMs: null, correctionLatencyMs: null, closingLatencyMs: null,
          serviceUtterances: null, closingRestarts: null, commandTimeouts: null, delegationRequests: null,
          liveSessions: null, speechRequests: null, providerCostUsd: null },
        comparability: "not_reviewed", injectionObserved: null, invalidReason: null, notes: []
      });
    }
    return { ...cohort, title: scenario.title, objective, allowedFacts: [...scenario.facts],
      context: catalog.context, recipientName: catalog.recipientName, representedPerson: { ...catalog.representedPerson },
      targetPhone: null, timeZone, actorLines: lines, expectedGoal: scenario.expected,
      initialLedgerEntries, expectedFinalLedgerEntries: scenario.ledger,
      expectedNewLedgerEntries, checks };
  });
  return {
    version: 1, kind: "offline_voice_acceptance_worksheet", createdAt: now.toISOString(), appointmentDate,
    catalogSha256: createHash("sha256").update(JSON.stringify(catalog)).digest("hex"),
    decision: "not_evaluated", externalExecutionAuthorized: false,
    requiredBeforeExternalExecution: {
      testRecipientApproval: null, testTargetReference: null, isolatedEnvironmentEvidence: null,
      baselineBuild: null, candidateBuild: null, configurationFingerprint: null,
      approvedCallLimit: null, approvedSpendLimit: null, scheduledWindow: null, operator: null
    },
    scope: "C/D/E/G conversational acceptance; B result verification; F behavior preserved; no real bookings",
    totalPairs: runs.length / 2, totalPlannedAttempts: runs.length,
    cohorts, runs
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { date: { type: "string" }, out: { type: "string" } } });
  if (!values.date || !values.out) throw new Error("Usage: node scripts/prepare-voice-acceptance.mjs --date YYYY-MM-DD --out PATH.json");
  const catalog = JSON.parse(await readFile(new URL("../docs/voice-acceptance-scenarios-2026-11-02.json", import.meta.url), "utf8"));
  const packet = prepareVoiceAcceptance(catalog, values.date);
  const destination = resolve(values.out);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(packet, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`Prepared offline worksheet: ${packet.totalPairs} pairs / ${packet.totalPlannedAttempts} planned attempts; none executed.\n${destination}\n`);
}
