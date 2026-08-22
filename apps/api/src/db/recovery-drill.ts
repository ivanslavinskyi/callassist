import "../config/load-env";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { decryptJson, parseDataEncryptionKey } from "../security/encryption";
import {
  readMigrationCatalog,
  runMigrations,
  validateAppliedMigrationNames,
  type MigrationCatalogEntry
} from "./migrate";

const restoreDatabasePrefix = "callassist_restore_drill_";
const temporaryDirectoryPrefix = "callassist-recovery-";
const criticalTables = [
  "audit_events",
  "call_briefs",
  "call_events",
  "credit_transactions",
  "durable_jobs",
  "sessions",
  "users"
] as const;
const encryptedColumns = [
  ["call_briefs", "allowed_facts_ciphertext"],
  ["call_briefs", "context_ciphertext"],
  ["call_briefs", "compilation_ciphertext"],
  ["call_briefs", "assistance_reason_ciphertext"],
  ["call_briefs", "assistance_disclosure_ciphertext"],
  ["final_transcripts", "text_ciphertext"],
  ["final_transcripts", "segments_ciphertext"],
  ["call_feedback_revisions", "comment_ciphertext"]
] as const;

type AppliedMigrationRow = {
  name: string;
  checksumSha256: string | null;
};

type DatabaseSnapshot = {
  migrations: AppliedMigrationRow[];
  publicTables: string[];
  rowCounts: Record<string, string>;
  serverVersion: string;
  encryptedSamplesVerified: number;
};

export type RecoverySource = {
  databaseUrl: string;
  databaseName: string;
  userName: string;
};

export function parseLocalRecoverySource(value: string | undefined): RecoverySource {
  if (!value?.trim()) {
    throw new Error("RECOVERY_SOURCE_DATABASE_URL or DATABASE_URL is required");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Recovery source must be a local PostgreSQL URL");
  }
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const userName = decodeURIComponent(url.username);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "::1", "postgres"].includes(hostname) ||
    !url.password ||
    !/^[a-z][a-z0-9_]*$/.test(databaseName) ||
    !/^[a-z][a-z0-9_]*$/.test(userName) ||
    ["postgres", "template0", "template1"].includes(databaseName)
  ) {
    throw new Error("Recovery source must be a named local application database");
  }
  return { databaseUrl: url.toString(), databaseName, userName };
}

export function validateMigrationSnapshot(
  rows: AppliedMigrationRow[],
  catalog: Array<Pick<MigrationCatalogEntry, "name" | "checksumSha256">>
) {
  validateAppliedMigrationNames(rows.map(({ name }) => name), catalog);
  const restoredByName = new Map(rows.map((row) => [row.name, row]));
  for (const migration of catalog) {
    const restored = restoredByName.get(migration.name);
    if (!restored) {
      throw new Error(`Restored migration is missing: ${migration.name}`);
    }
    if (restored.checksumSha256 !== migration.checksumSha256) {
      throw new Error(`Restored migration checksum mismatch: ${migration.name}`);
    }
  }
}

export function validateCriticalTables(tableNames: string[]) {
  const available = new Set(tableNames);
  const missing = criticalTables.filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new Error(`Restored critical tables are missing: ${missing.join(", ")}`);
  }
}

export async function runRecoveryDrill(
  environment: NodeJS.ProcessEnv = process.env
) {
  const startedAt = Date.now();
  const source = parseLocalRecoverySource(
    environment.RECOVERY_SOURCE_DATABASE_URL?.trim() || environment.DATABASE_URL
  );
  const encryptionKey = parseDataEncryptionKey(environment.DATA_ENCRYPTION_KEY);
  const container = await resolvePostgresContainer(
    environment.RECOVERY_POSTGRES_CONTAINER
  );
  const catalog = await readMigrationCatalog();
  const sourceSnapshot = await readDatabaseSnapshot(
    source.databaseUrl,
    encryptionKey
  );
  validateMigrationSnapshot(sourceSnapshot.migrations, catalog);
  validateCriticalTables(sourceSnapshot.publicTables);

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), temporaryDirectoryPrefix)
  );
  const backupPath = join(temporaryDirectory, "database.dump");
  const restoreDatabaseName = `${restoreDatabasePrefix}${randomBytes(8).toString("hex")}`;
  assertDisposableRestoreTarget(restoreDatabaseName);
  const adminUrl = new URL(source.databaseUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";
  adminUrl.hash = "";
  const restoreUrl = new URL(source.databaseUrl);
  restoreUrl.pathname = `/${restoreDatabaseName}`;
  restoreUrl.search = "";
  restoreUrl.hash = "";
  const adminSql = postgres(adminUrl.toString(), {
    max: 1,
    onnotice: () => undefined
  });
  let restoreDatabaseCreated = false;
  let evidence: Record<string, unknown> | undefined;

  try {
    const dumpVersion = await runDockerCapture([
      "exec", container, "pg_dump", "--version"
    ], "pg_dump version check");
    const restoreVersion = await runDockerCapture([
      "exec", container, "pg_restore", "--version"
    ], "pg_restore version check");
    await runDockerProcess([
      "exec",
      container,
      "pg_dump",
      "--format=custom",
      "--compress=6",
      "--no-owner",
      "--no-privileges",
      "--username",
      source.userName,
      "--dbname",
      source.databaseName
    ], "database backup", { outputFile: backupPath });

    await adminSql.unsafe(
      `CREATE DATABASE "${restoreDatabaseName}" OWNER "${source.userName}" TEMPLATE template0`
    );
    restoreDatabaseCreated = true;
    await runDockerProcess([
      "exec",
      "--interactive",
      container,
      "pg_restore",
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      "--username",
      source.userName,
      "--dbname",
      restoreDatabaseName
    ], "database restore", { inputFile: backupPath });

    await runMigrations(restoreUrl.toString());
    const restoredSnapshot = await readDatabaseSnapshot(
      restoreUrl.toString(),
      encryptionKey
    );
    validateMigrationSnapshot(restoredSnapshot.migrations, catalog);
    validateCriticalTables(restoredSnapshot.publicTables);
    assertSnapshotsMatch(sourceSnapshot, restoredSnapshot);

    const backup = await stat(backupPath);
    evidence = {
      event: "database_recovery_drill_succeeded",
      schemaVersion: 1,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      databaseServerVersion: sourceSnapshot.serverVersion,
      dumpToolVersion: firstLine(dumpVersion),
      restoreToolVersion: firstLine(restoreVersion),
      backupFormat: "postgresql-custom",
      backupBytes: backup.size,
      backupSha256: await sha256File(backupPath),
      migrationCount: catalog.length,
      latestMigration: catalog.at(-1)?.name ?? null,
      publicTableCount: restoredSnapshot.publicTables.length,
      rowCountChecks: restoredSnapshot.publicTables.length,
      criticalTableCount: criticalTables.length,
      encryptedSamplesVerified: restoredSnapshot.encryptedSamplesVerified
    };
  } finally {
    try {
      if (restoreDatabaseCreated) {
        assertDisposableRestoreTarget(restoreDatabaseName);
        await adminSql`
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = ${restoreDatabaseName} AND pid <> pg_backend_pid()
        `;
        await adminSql.unsafe(`DROP DATABASE "${restoreDatabaseName}"`);
      }
    } finally {
      try {
        await adminSql.end();
      } finally {
        assertDisposableTemporaryDirectory(temporaryDirectory);
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    }
  }

  if (!evidence) throw new Error("Recovery drill did not produce evidence");
  return { ...evidence, temporaryResourcesRemoved: true };
}

async function readDatabaseSnapshot(
  databaseUrl: string,
  encryptionKey: Buffer
): Promise<DatabaseSnapshot> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const migrations = await sql<AppliedMigrationRow[]>`
      SELECT name, checksum_sha256 AS "checksumSha256"
      FROM schema_migrations
      ORDER BY name
    `;
    const tableRows = await sql<{ tableName: string }[]>`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    const [{ serverVersion }] = await sql<{ serverVersion: string }[]>`
      SELECT current_setting('server_version') AS "serverVersion"
    `;
    const publicTables = tableRows.map(({ tableName }) => tableName);
    validateCriticalTables(publicTables);
    const rowCounts: Record<string, string> = {};
    for (const table of publicTables) {
      const [row] = await sql.unsafe<{ rowCount: string }[]>(
        `SELECT count(*)::text AS "rowCount" FROM ${quoteIdentifier(table)}`
      );
      rowCounts[table] = row?.rowCount ?? "0";
    }
    for (const table of criticalTables) {
      await sql.unsafe(`SELECT 1 FROM "${table}" LIMIT 1`);
    }
    let encryptedSamplesVerified = 0;
    for (const [table, column] of encryptedColumns) {
      const rows = await sql.unsafe<{ payload: string }[]>(
        `SELECT "${column}" AS payload FROM "${table}" WHERE "${column}" IS NOT NULL LIMIT 1`
      );
      if (rows[0]?.payload) {
        decryptJson<unknown>(rows[0].payload, encryptionKey);
        encryptedSamplesVerified += 1;
      }
    }
    return {
      migrations,
      publicTables,
      rowCounts,
      serverVersion: serverVersion ?? "unknown",
      encryptedSamplesVerified
    };
  } finally {
    await sql.end();
  }
}

function assertSnapshotsMatch(source: DatabaseSnapshot, restored: DatabaseSnapshot) {
  if (
    JSON.stringify(source.migrations) !== JSON.stringify(restored.migrations) ||
    JSON.stringify(source.publicTables) !== JSON.stringify(restored.publicTables) ||
    JSON.stringify(source.rowCounts) !== JSON.stringify(restored.rowCounts) ||
    source.encryptedSamplesVerified !== restored.encryptedSamplesVerified
  ) {
    throw new Error("Restored database does not match the source snapshot");
  }
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function resolvePostgresContainer(explicit: string | undefined) {
  if (explicit?.trim()) return validateContainerReference(explicit.trim());
  const output = await runDockerCapture(
    ["compose", "ps", "--quiet", "postgres"],
    "PostgreSQL container discovery"
  );
  const containers = output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (containers.length !== 1) {
    throw new Error(
      "Set RECOVERY_POSTGRES_CONTAINER to the single PostgreSQL container ID"
    );
  }
  return validateContainerReference(containers[0]!);
}

function validateContainerReference(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)) {
    throw new Error("RECOVERY_POSTGRES_CONTAINER is invalid");
  }
  return value;
}

function assertDisposableRestoreTarget(value: string) {
  if (!/^callassist_restore_drill_[a-f0-9]{16}$/.test(value)) {
    throw new Error("Refusing to mutate a non-drill database target");
  }
}

function assertDisposableTemporaryDirectory(value: string) {
  const expectedPrefix = join(tmpdir(), temporaryDirectoryPrefix);
  if (!value.startsWith(expectedPrefix)) {
    throw new Error("Refusing to remove a non-drill temporary directory");
  }
}

async function runDockerCapture(args: string[], label: string) {
  return runDockerProcess(args, label, { captureOutput: true });
}

async function runDockerProcess(
  args: string[],
  label: string,
  options: {
    captureOutput?: boolean;
    inputFile?: string;
    outputFile?: string;
  } = {}
) {
  const input = options.inputFile ? await open(options.inputFile, "r") : undefined;
  const output = options.outputFile
    ? await open(options.outputFile, "wx", 0o600)
    : undefined;
  try {
    const child = spawn("docker", args, {
      windowsHide: true,
      stdio: [
        input ? input.fd : "ignore",
        output ? output.fd : options.captureOutput ? "pipe" : "ignore",
        "pipe"
      ]
    });
    let captured = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      captured = `${captured}${chunk}`.slice(-32_768);
    });
    child.stderr?.resume();
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", () => reject(new Error(`Unable to start ${label}`)));
      child.once("close", (code) => resolve(code ?? 1));
    });
    if (exitCode !== 0) {
      throw new Error(`${label} failed with exit code ${exitCode}`);
    }
    return captured.trim();
  } finally {
    await input?.close();
    await output?.close();
  }
}

async function sha256File(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function firstLine(value: string) {
  return value.split(/\r?\n/, 1)[0] ?? "unknown";
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  const evidence = await runRecoveryDrill();
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}
