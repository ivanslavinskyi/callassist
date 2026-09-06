import "../config/load-env";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseDataEncryptionKeyring } from "../security/encryption";
import { CallRepositoryError } from "../storage/call-repository";
import { PostgresCallRepository } from "../storage/postgres-call-repository";

export const callCompilationBackfillConfirmation =
  "BACKFILL_RECOVERABLE_CALL_COMPILATIONS";

export function parseCallCompilationBackfillBatchSize(
  value: string | undefined
) {
  const parsed = value === undefined || value.trim() === ""
    ? 100
    : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error("CALL_COMPILATION_BACKFILL_BATCH_SIZE must be 1..500");
  }
  return parsed;
}

export function assertCallCompilationBackfillConfirmation(
  confirmation: string | undefined
) {
  if (confirmation?.trim() !== callCompilationBackfillConfirmation) {
    throw new Error(
      "CALL_COMPILATION_BACKFILL_CONFIRM must explicitly confirm the backfill"
    );
  }
}

export function parseCallCompilationBackfillMode(args: string[]) {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  if (normalized.length === 0) return "dry_run" as const;
  if (normalized.length === 1 && normalized[0] === "--execute") {
    return "execute" as const;
  }
  throw new Error("The call compilation backfill accepts only --execute");
}

export function callCompilationBackfillErrorCode(error: unknown) {
  if (error instanceof CallRepositoryError) return error.code;
  if (
    error instanceof Error &&
    error.message === "CALL_EXECUTION_SNAPSHOT_NOT_APPROVED"
  ) {
    return "CALL_EXECUTION_SNAPSHOT_NOT_APPROVED";
  }
  if (
    error instanceof Error &&
    error.message === "Recoverable legacy compilations remain after backfill"
  ) {
    return "CALL_COMPILATION_BACKFILL_INCOMPLETE";
  }
  return "CALL_COMPILATION_BACKFILL_FAILED";
}

export async function backfillCallCompilations(
  environment: NodeJS.ProcessEnv = process.env,
  args: string[] = process.argv.slice(2)
) {
  const startedAt = Date.now();
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const mode = parseCallCompilationBackfillMode(args);
  const batchSize = parseCallCompilationBackfillBatchSize(
    environment.CALL_COMPILATION_BACKFILL_BATCH_SIZE
  );
  if (mode === "execute") {
    assertCallCompilationBackfillConfirmation(
      environment.CALL_COMPILATION_BACKFILL_CONFIRM
    );
  }
  const repository = new PostgresCallRepository(
    databaseUrl,
    parseDataEncryptionKeyring(environment)
  );
  const readCutoverFacts = async () => (
    await repository.getAdminSystemFacts(
      new Date().toISOString(),
      new Date(Date.now() - 86_400_000).toISOString()
    )
  ).callPlanCutover;

  try {
    const before = await readCutoverFacts();
    let scannedCandidates = 0;
    let validCandidates = 0;
    let invalidCandidates = 0;
    let decryptionFailures = 0;
    let unsupportedCompilerVersions = 0;
    const unsupportedCompilerVersionCounts: Record<string, number> = {};
    let schemaValidationFailures = 0;
    const schemaIssueCounts: Record<string, number> = {};
    let snapshotHashFailures = 0;
    let approvalStateFailures = 0;
    let approvalSnapshotFailures = 0;
    let approvalSnapshotsRequired = 0;
    let backfilledCompilations = 0;
    let approvalSnapshotsCreated = 0;
    let cursor: string | null = null;
    while (true) {
      const batch = await repository.backfillLegacyCompilationBatch(
        batchSize,
        cursor,
        mode === "execute"
      );
      scannedCandidates += batch.scannedCandidates;
      validCandidates += batch.validCandidates;
      invalidCandidates += batch.invalidCandidates;
      decryptionFailures += batch.decryptionFailures;
      unsupportedCompilerVersions += batch.unsupportedCompilerVersions;
      mergeCounts(
        unsupportedCompilerVersionCounts,
        batch.unsupportedCompilerVersionCounts
      );
      schemaValidationFailures += batch.schemaValidationFailures;
      mergeCounts(schemaIssueCounts, batch.schemaIssueCounts);
      snapshotHashFailures += batch.snapshotHashFailures;
      approvalStateFailures += batch.approvalStateFailures;
      approvalSnapshotFailures += batch.approvalSnapshotFailures;
      approvalSnapshotsRequired += batch.approvalSnapshotsRequired;
      backfilledCompilations += batch.backfilledCompilations;
      approvalSnapshotsCreated += batch.approvalSnapshotsCreated;
      if (batch.scannedCandidates < batchSize || !batch.lastScannedId) break;
      cursor = batch.lastScannedId;
    }
    const after = await readCutoverFacts();
    const incomplete = mode === "execute" && after.recoverableLegacyCalls !== 0;
    return {
      event: mode === "dry_run"
        ? "call_compilation_backfill_dry_run"
        : incomplete
          ? "call_compilation_backfill_incomplete"
          : "call_compilation_backfill_succeeded",
      schemaVersion: 1,
      runId: randomUUID(),
      mode,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      batchSize,
      before,
      scannedCandidates,
      validCandidates,
      invalidCandidates,
      decryptionFailures,
      unsupportedCompilerVersions,
      unsupportedCompilerVersionCounts,
      schemaValidationFailures,
      schemaIssueCounts,
      snapshotHashFailures,
      approvalStateFailures,
      approvalSnapshotFailures,
      approvalSnapshotsRequired,
      backfilledCompilations,
      approvalSnapshotsCreated,
      after
    };
  } finally {
    await repository.close();
  }
}

function mergeCounts(
  target: Record<string, number>,
  source: Record<string, number>
) {
  for (const [key, count] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + count;
  }
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  try {
    const evidence = await backfillCallCompilations();
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
    if (evidence.event === "call_compilation_backfill_incomplete") {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      event: "call_compilation_backfill_failed",
      errorCode: callCompilationBackfillErrorCode(error)
    })}\n`);
    process.exitCode = 1;
  }
}
