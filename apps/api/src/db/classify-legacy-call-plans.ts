import "../config/load-env";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseDataEncryptionKeyring } from "../security/encryption";
import { PostgresCallRepository } from "../storage/postgres-call-repository";

export const legacyCallPlanClassificationConfirmation =
  "CLASSIFY_INCOMPATIBLE_LEGACY_CALL_PLANS";

export function parseLegacyCallPlanClassificationBatchSize(
  value: string | undefined
) {
  const parsed = value === undefined || value.trim() === ""
    ? 100
    : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error("LEGACY_CALL_PLAN_CLASSIFICATION_BATCH_SIZE must be 1..500");
  }
  return parsed;
}

export function assertLegacyCallPlanClassificationConfirmation(
  confirmation: string | undefined
) {
  if (confirmation?.trim() !== legacyCallPlanClassificationConfirmation) {
    throw new Error(
      "LEGACY_CALL_PLAN_CLASSIFICATION_CONFIRM must explicitly confirm classification"
    );
  }
}

export function parseLegacyCallPlanClassificationMode(args: string[]) {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  if (normalized.length === 0) return "dry_run" as const;
  if (normalized.length === 1 && normalized[0] === "--execute") {
    return "execute" as const;
  }
  throw new Error("Legacy call-plan classification accepts only --execute");
}

export function legacyCallPlanClassificationErrorCode(error: unknown) {
  if (
    error instanceof Error &&
    error.message === "Valid legacy compilations remain; run backfill first"
  ) {
    return "LEGACY_CALL_PLAN_BACKFILL_REQUIRED";
  }
  if (
    error instanceof Error &&
    error.message === "Active recompilations prevent legacy classification"
  ) {
    return "LEGACY_CALL_PLAN_RECOMPILATION_ACTIVE";
  }
  if (
    error instanceof Error &&
    error.message === "Legacy call-plan classification is incomplete"
  ) {
    return "LEGACY_CALL_PLAN_CLASSIFICATION_INCOMPLETE";
  }
  return "LEGACY_CALL_PLAN_CLASSIFICATION_FAILED";
}

export async function classifyLegacyCallPlans(
  environment: NodeJS.ProcessEnv = process.env,
  args: string[] = process.argv.slice(2)
) {
  const startedAt = Date.now();
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const mode = parseLegacyCallPlanClassificationMode(args);
  const batchSize = parseLegacyCallPlanClassificationBatchSize(
    environment.LEGACY_CALL_PLAN_CLASSIFICATION_BATCH_SIZE
  );
  if (mode === "execute") {
    assertLegacyCallPlanClassificationConfirmation(
      environment.LEGACY_CALL_PLAN_CLASSIFICATION_CONFIRM
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
    let validatedCandidates = 0;
    let validCandidates = 0;
    let invalidCandidates = 0;
    let validationCursor: string | null = null;
    while (true) {
      const batch = await repository.backfillLegacyCompilationBatch(
        batchSize,
        validationCursor,
        false
      );
      validatedCandidates += batch.scannedCandidates;
      validCandidates += batch.validCandidates;
      invalidCandidates += batch.invalidCandidates;
      if (batch.scannedCandidates < batchSize || !batch.lastScannedId) break;
      validationCursor = batch.lastScannedId;
    }
    if (mode === "execute" && validCandidates > 0) {
      throw new Error("Valid legacy compilations remain; run backfill first");
    }
    if (mode === "execute" && before.activeRecompilations > 0) {
      throw new Error("Active recompilations prevent legacy classification");
    }

    let scannedCandidates = 0;
    let archivedTerminal = 0;
    let recompileRequired = 0;
    let unclassified = 0;
    let cursor: string | null = null;
    while (true) {
      const batch = await repository.classifyLegacyCallPlanBatch(
        batchSize,
        cursor,
        mode === "execute"
      );
      scannedCandidates += batch.scannedCandidates;
      archivedTerminal += batch.archivedTerminal;
      recompileRequired += batch.recompileRequired;
      unclassified += batch.unclassified;
      if (batch.scannedCandidates < batchSize || !batch.lastScannedId) break;
      cursor = batch.lastScannedId;
    }
    const after = await readCutoverFacts();
    const incomplete = mode === "execute" && after.recoverableLegacyCalls !== 0;
    if (incomplete) {
      throw new Error("Legacy call-plan classification is incomplete");
    }
    return {
      event: mode === "dry_run"
        ? "legacy_call_plan_classification_dry_run"
        : "legacy_call_plan_classification_succeeded",
      schemaVersion: 1,
      runId: randomUUID(),
      mode,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      batchSize,
      before,
      validatedCandidates,
      validCandidates,
      invalidCandidates,
      scannedCandidates,
      archivedTerminal,
      recompileRequired,
      unclassified,
      after
    };
  } finally {
    await repository.close();
  }
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  try {
    const evidence = await classifyLegacyCallPlans();
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      event: "legacy_call_plan_classification_failed",
      errorCode: legacyCallPlanClassificationErrorCode(error)
    })}\n`);
    process.exitCode = 1;
  }
}
