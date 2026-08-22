import "../config/load-env";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";

const migrationsDirectory = fileURLToPath(new URL("migrations", import.meta.url));

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
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const appliedRows = await sql<{ name: string }[]>`
      SELECT name FROM schema_migrations
    `;
    const applied = new Set(appliedRows.map(({ name }) => name));
    const files = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const name of files) {
      if (applied.has(name)) continue;
      const migration = await readFile(
        new URL(`migrations/${name}`, import.meta.url),
        "utf8"
      );

      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration);
        await transaction`
          INSERT INTO schema_migrations (name) VALUES (${name})
        `;
      });

      console.info(`Applied migration ${name}`);
    }
  } finally {
    await sql.end();
  }
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  await runMigrations();
}
