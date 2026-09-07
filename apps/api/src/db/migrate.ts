import "../config/load-env";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";
import {
  evaluateCallPlanCutoverGate,
  type CallPlanCutoverGateFacts
} from "./call-plan-cutover-gate";

const migrationsDirectory = fileURLToPath(new URL("migrations", import.meta.url));
const legacyAppliedMigrationTombstones = new Set([
  // Applied by the local supervised-MVP schema before the identity migration
  // established the current contiguous catalog. It is never run on a fresh DB.
  "0013_final_transcript_quality.sql"
]);
const immutableCallPlanFinalizationMigration =
  "0061_complete_immutable_call_plan_cutover.sql";

export function assertCallPlanCutoverMigrationReady(
  facts: CallPlanCutoverGateFacts
) {
  const gate = evaluateCallPlanCutoverGate(facts);
  if (!gate.ready) {
    throw new Error(
      `Immutable call-plan finalization blocked: ${gate.blockers.join(",")}`
    );
  }
}

export type MigrationCatalogEntry = {
  name: string;
  sequence: number;
  checksumSha256: string;
  legacyCrlfChecksumSha256: string;
  sql: string;
};

export async function readMigrationCatalog(
  directory = migrationsDirectory
): Promise<MigrationCatalogEntry[]> {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const entries = await Promise.all(names.map(async (name) => {
    const sql = (await readFile(join(directory, name), "utf8"))
      .replace(/\r\n?/g, "\n");
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(name);
    if (!match) throw new Error(`Invalid migration filename: ${name}`);
    if (!sql.trim()) throw new Error(`Migration is empty: ${name}`);
    const checksum = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    return {
      name,
      sequence: Number(match[1]),
      checksumSha256: checksum(sql),
      legacyCrlfChecksumSha256: checksum(sql.replace(/\n/g, "\r\n")),
      sql
    };
  }));
  validateMigrationSequence(entries);
  return entries;
}

export function validateMigrationSequence(
  entries: Array<Pick<MigrationCatalogEntry, "name" | "sequence">>
) {
  if (entries.length === 0) {
    throw new Error("Migration catalog must not be empty");
  }
  for (const [index, entry] of entries.entries()) {
    const expected = index + 1;
    if (entry.sequence !== expected) {
      throw new Error(
        `Migration sequence must be contiguous: expected ${String(expected).padStart(4, "0")}, found ${entry.name}`
      );
    }
  }
}

export function validateAppliedMigrationNames(
  appliedNames: string[],
  catalog: Array<Pick<MigrationCatalogEntry, "name">>,
  allowedMissingNames = legacyAppliedMigrationTombstones
) {
  const catalogNames = new Set(catalog.map(({ name }) => name));
  for (const name of appliedNames) {
    if (!catalogNames.has(name) && !allowedMissingNames.has(name)) {
      throw new Error(`Applied migration is missing from catalog: ${name}`);
    }
  }
}

export async function runMigrations(
  databaseUrl = process.env.DATABASE_URL
) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });

  try {
    await sql`SELECT pg_advisory_lock(742303984)`;
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum_sha256 varchar(64),
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      ALTER TABLE schema_migrations
      ADD COLUMN IF NOT EXISTS checksum_sha256 varchar(64)
    `;

    const appliedRows = await sql<{
      name: string;
      checksumSha256: string | null;
    }[]>`
      SELECT name, checksum_sha256 AS "checksumSha256"
      FROM schema_migrations
    `;
    const catalog = await readMigrationCatalog();
    validateAppliedMigrationNames(
      appliedRows.map(({ name }) => name),
      catalog
    );
    const applied = new Map(appliedRows.map((row) => [row.name, row]));

    for (const migration of catalog) {
      const existing = applied.get(migration.name);
      if (existing?.checksumSha256) {
        if (
          existing.checksumSha256 !== migration.checksumSha256 &&
          existing.checksumSha256 !== migration.legacyCrlfChecksumSha256
        ) {
          throw new Error(`Applied migration checksum mismatch: ${migration.name}`);
        }
        if (existing.checksumSha256 !== migration.checksumSha256) {
          await sql`
            UPDATE schema_migrations
            SET checksum_sha256 = ${migration.checksumSha256}
            WHERE name = ${migration.name}
              AND checksum_sha256 = ${existing.checksumSha256}
          `;
        }
        continue;
      }
      if (existing) {
        await sql`
          UPDATE schema_migrations
          SET checksum_sha256 = ${migration.checksumSha256}
          WHERE name = ${migration.name} AND checksum_sha256 IS NULL
        `;
        continue;
      }

      await sql.begin(async (transaction) => {
        if (migration.name === immutableCallPlanFinalizationMigration) {
          await transaction.unsafe(
            "LOCK TABLE call_briefs, call_attempts, " +
              "call_preparation_requests IN SHARE MODE"
          );
          const [facts] = await transaction<CallPlanCutoverGateFacts[]>`
            SELECT
              (
                SELECT count(*)::int FROM call_briefs
                WHERE data_deleted_at IS NULL
                  AND current_compilation_id IS NULL
                  AND compilation_ciphertext IS NOT NULL
                  AND legacy_compilation_disposition IS NULL
              ) AS "recoverableLegacyCalls",
              (
                SELECT count(*)::int FROM call_briefs
                WHERE data_deleted_at IS NULL
                  AND current_compilation_id IS NULL
                  AND status IN (
                    'ready',
                    'dialing',
                    'in_progress',
                    'awaiting_approval'
                  )
              ) AS "executableLegacyCalls",
              (
                SELECT count(*)::int
                FROM call_attempts
                JOIN call_briefs
                  ON call_briefs.id = call_attempts.call_brief_id
                WHERE call_briefs.data_deleted_at IS NULL
                  AND call_attempts.ended_at IS NULL
                  AND (
                    call_attempts.compilation_id IS NULL
                    OR call_attempts.execution_snapshot_ciphertext IS NULL
                  )
              ) AS "activeLegacyAttempts",
              (
                SELECT count(*)::int FROM call_preparation_requests
                WHERE operation_kind = 'recompilation'
                  AND status IN ('queued', 'processing', 'retrying')
              ) AS "activeRecompilations"
          `;
          if (!facts) {
            throw new Error("Immutable call-plan finalization facts unavailable");
          }
          assertCallPlanCutoverMigrationReady(facts);
        }

        await transaction.unsafe(migration.sql);
        await transaction`
          INSERT INTO schema_migrations (name, checksum_sha256)
          VALUES (${migration.name}, ${migration.checksumSha256})
        `;
      });

      console.info(`Applied migration ${migration.name}`);
    }
  } finally {
    await sql.end();
  }
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  if (process.argv.includes("--check")) {
    const catalog = await readMigrationCatalog();
    process.stdout.write(`${JSON.stringify({
      event: "migration_catalog_valid",
      count: catalog.length,
      latest: catalog.at(-1)?.name ?? null
    })}\n`);
  } else {
    await runMigrations();
  }
}
