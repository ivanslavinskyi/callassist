import "../config/load-env";
import { pathToFileURL } from "node:url";
import { parseDataEncryptionKeyring } from "../security/encryption";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { evaluateCallPlanCutoverGate } from "./call-plan-cutover-gate";

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
