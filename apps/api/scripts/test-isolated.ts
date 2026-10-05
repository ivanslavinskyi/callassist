import "../src/config/load-env";
import { spawn } from "node:child_process";
import { isolatedTestDatabase } from "../src/db/isolated-test-database";

// Does not reset an existing developer database. Drops only its own random *_test DB.
const database = isolatedTestDatabase();
try {
  await database.setup();
  const result = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...process.argv.slice(2)], {
      stdio: "inherit", env: { ...process.env, TEST_DATABASE_URL: database.url }
    });
    child.on("error", reject);
    child.on("exit", code => resolve(code ?? 1));
  });
  process.exitCode = result;
} finally { await database.teardown(); }
