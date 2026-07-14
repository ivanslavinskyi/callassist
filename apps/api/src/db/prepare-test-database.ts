import "../config/load-env";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

export async function prepareTestDatabase(
  databaseUrl = process.env.DATABASE_URL,
  testDatabaseUrl = process.env.TEST_DATABASE_URL
) {
  if (!databaseUrl || !testDatabaseUrl) {
    throw new Error("DATABASE_URL and TEST_DATABASE_URL are required");
  }

  const adminUrl = new URL(databaseUrl);
  const testUrl = new URL(testDatabaseUrl);
  const databaseName = testUrl.pathname.replace(/^\//, "");
  const owner = decodeURIComponent(adminUrl.username);

  if (!/^[a-z][a-z0-9_]*$/.test(databaseName)) {
    throw new Error("TEST_DATABASE_URL must use a simple PostgreSQL database name");
  }
  if (!/^[a-z][a-z0-9_]*$/.test(owner)) {
    throw new Error("DATABASE_URL must use a simple PostgreSQL user name");
  }
  if (
    adminUrl.hostname !== testUrl.hostname ||
    adminUrl.port !== testUrl.port ||
    adminUrl.username !== testUrl.username
  ) {
    throw new Error("Test and development databases must use the same local server");
  }

  adminUrl.pathname = "/postgres";
  const sql = postgres(adminUrl.toString(), {
    max: 1,
    onnotice: () => undefined
  });

  try {
    const [existing] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS(
        SELECT 1 FROM pg_database WHERE datname = ${databaseName}
      ) AS exists
    `;
    if (!existing?.exists) {
      await sql.unsafe(`CREATE DATABASE "${databaseName}" OWNER "${owner}"`);
      console.info(`Created test database ${databaseName}`);
    }
  } finally {
    await sql.end();
  }
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  await prepareTestDatabase();
}
