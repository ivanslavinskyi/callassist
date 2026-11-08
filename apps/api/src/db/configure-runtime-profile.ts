import "../config/load-env";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { preparationRuntimePolicySchema } from "@callassist/contracts";
import { selectedRuntimeProfile } from "../config/runtime-profile";
import { readMigrationCatalog, validateAppliedMigrationNames } from "./migrate";

export class RuntimeProfileConfigurationError extends Error {}

/** Deployment operation: stop API/workers first. Never rewrites pinned requests or approvals. */
export async function configureRuntimeProfile(args = process.argv.slice(2), environment: NodeJS.ProcessEnv = process.env) {
  if (args.some(arg => !["--apply", "--check"].includes(arg)) || (args.includes("--apply") && args.includes("--check"))) {
    throw new RuntimeProfileConfigurationError("Use runtime:configure [--apply|--check]; no flag previews the change");
  }
  let profile: ReturnType<typeof selectedRuntimeProfile>;
  try { profile = selectedRuntimeProfile(environment); }
  catch (error) { throw new RuntimeProfileConfigurationError((error as Error).message); }
  if (!profile) throw new RuntimeProfileConfigurationError("CALL_RUNTIME_PROFILE must be explicitly selected");
  if (environment.STORAGE_DRIVER !== "postgres" || !environment.DATABASE_URL) {
    throw new RuntimeProfileConfigurationError("Runtime profile configuration requires STORAGE_DRIVER=postgres and DATABASE_URL");
  }
  const sql = postgres(environment.DATABASE_URL, { max: 1, onnotice: () => undefined });
  const apply = args.includes("--apply");
  try {
    const catalog = await readMigrationCatalog();
    const applied = await sql<{ name: string; checksum_sha256: string | null }[]>`SELECT name,checksum_sha256 FROM schema_migrations`;
    try { validateAppliedMigrationNames(applied.map(row => row.name), catalog); }
    catch { throw new RuntimeProfileConfigurationError("RUNTIME_PROFILE_SCHEMA_MISMATCH: run migrations with this release first"); }
    if (!catalog.some(migration => migration.name === profile.minimumMigration) || catalog.some(migration => {
      const row = applied.find(entry => entry.name === migration.name);
      return !row || ![migration.checksumSha256, migration.legacyCrlfChecksumSha256].includes(row.checksum_sha256 ?? "");
    })) throw new RuntimeProfileConfigurationError("RUNTIME_PROFILE_SCHEMA_MISMATCH: run migrations with this release first");
    return await sql.begin(async tx => {
      await tx`SET LOCAL lock_timeout = '5s'`;
      // Match the table-before-row order used by INSERT triggers; prevent concurrent admission.
      if (apply) await tx`LOCK TABLE call_attempts,call_preparation_requests IN SHARE MODE`;
      const [row] = await tx`SELECT policy,capacity,approved_profiles FROM preparation_settings WHERE id=true FOR UPDATE`;
      if (!row) throw new RuntimeProfileConfigurationError("PREPARATION_SETTINGS_MISSING");
      const parsed = preparationRuntimePolicySchema.safeParse(row.policy);
      if (!parsed.success) throw new RuntimeProfileConfigurationError("PREPARATION_POLICY_UNSUPPORTED");
      const before = { promptVersion: parsed.data.promptVersion, revision: parsed.data.revision };
      const changeRequired = before.promptVersion !== profile.promptVersion;
      const [active] = await tx<{ calls: number; preparations: number }[]>`SELECT
        (SELECT count(*)::int FROM call_attempts WHERE ended_at IS NULL AND status IN ('dialing','in_progress')) AS calls,
        (SELECT count(*)::int FROM call_preparation_requests WHERE status IN ('queued','processing','retrying')) AS preparations`;
      if (apply && changeRequired && (active!.calls || active!.preparations)) {
        throw new RuntimeProfileConfigurationError("RUNTIME_PROFILE_BUSY: drain calls and preparations and stop API/workers before applying");
      }
      const changed = apply && changeRequired;
      const nextPolicy = changed ? { ...row.policy, promptVersion: profile.promptVersion, revision: before.revision + 1 } : row.policy;
      if (changed) {
        const previous = { policy: row.policy, capacity: row.capacity, approvedProfiles: row.approved_profiles };
        const next = { ...previous, policy: nextPolicy, runtimeProfile: profile.name, runtimeRelease: profile.release };
        const reason = `Activate runtime profile ${profile.name} (${profile.release}); preserve pinned work`;
        await tx`UPDATE preparation_settings SET policy=${tx.json(nextPolicy)},updated_at=clock_timestamp(),
          updated_by_user_id=NULL,reason=${reason} WHERE id=true`;
        await tx`INSERT INTO preparation_settings_audit(id,actor_user_id,reason,previous_settings,next_settings)
          VALUES(${randomUUID()},NULL,${reason},${tx.json(previous)},${tx.json(next)})`;
      }
      return { mode: apply ? "apply" : args.includes("--check") ? "check" : "preview", profile,
        before, after: { promptVersion: nextPolicy.promptVersion, revision: nextPolicy.revision },
        changeRequired, changed, ready: nextPolicy.promptVersion === profile.promptVersion,
        active: active!, databaseChecked: true, providerTraffic: false };
    });
  } finally { await sql.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  configureRuntimeProfile().then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (result.mode === "check" && !result.ready) process.exitCode = 1;
  }).catch(error => {
    // Connection errors may contain credentials/hosts; only our controlled diagnostics are printed.
    console.error(error instanceof RuntimeProfileConfigurationError ? error.message : "RUNTIME_PROFILE_CONFIGURATION_FAILED");
    process.exitCode = 1;
  });
}
