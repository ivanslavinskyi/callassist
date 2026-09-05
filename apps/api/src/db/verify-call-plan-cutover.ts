import "../config/load-env";
import { pathToFileURL } from "node:url";
import { parseDataEncryptionKeyring } from "../security/encryption";
import type { AdminSystemFacts } from "../storage/call-repository";
import { PostgresCallRepository } from "../storage/postgres-call-repository";

type CallPlanCutoverFacts = AdminSystemFacts["callPlanCutover"];

export function evaluateCallPlanCutoverGate(facts: CallPlanCutoverFacts) {
  const blockers = [
    facts.recoverableLegacyCalls > 0
      ? "recoverable_legacy_calls"
      : null,
    facts.executableLegacyCalls > 0
      ? "executable_legacy_calls"
      : null,
    facts.activeLegacyAttempts > 0
      ? "active_legacy_attempts"
      : null,
    facts.activeRecompilations > 0
      ? "active_recompilations"
      : null
  ].filter((value): value is string => value !== null);
  return { ready: blockers.length === 0, blockers };
}

export function callPlanCutoverVerificationErrorCode(error: unknown) {
  void error;
  return "CALL_PLAN_CUTOVER_VERIFICATION_FAILED";
}

export async function verifyCallPlanCutover(
  environment: NodeJS.ProcessEnv = process.env
) {
  const startedAt = Date.now();
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const repository = new PostgresCallRepository(
    databaseUrl,
    parseDataEncryptionKeyring(environment)
  );
  try {
    const facts = (
      await repository.getAdminSystemFacts(
        new Date().toISOString(),
        new Date(Date.now() - 86_400_000).toISOString()
      )
    ).callPlanCutover;
    const gate = evaluateCallPlanCutoverGate(facts);
    return {
      event: gate.ready
        ? "call_plan_cutover_ready"
        : "call_plan_cutover_not_ready",
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      ready: gate.ready,
      blockers: gate.blockers,
      facts
    };
  } finally {
    await repository.close();
  }
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  try {
    const evidence = await verifyCallPlanCutover();
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
    if (!evidence.ready) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      event: "call_plan_cutover_verification_failed",
      errorCode: callPlanCutoverVerificationErrorCode(error)
    })}\n`);
    process.exitCode = 1;
  }
}
