import "../src/config/load-env";
import { mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { isolatedTestDatabase } from "../src/db/isolated-test-database";

// The parent creates and drops only a strictly named disposable *_test database.
// The user's configured development and shared test databases are never cleared.
const database = isolatedTestDatabase();
try {
  const reportDirectory = resolve(process.cwd(), "../../.tools/verification-language");
  await mkdir(reportDirectory, { recursive: true });
  await database.setup();
  const entries = await readdir(resolve("src"), { recursive: true });
  const tests = entries.filter((name) => name.endsWith(".integration.test.ts")).map((name) => resolve("src", name));
  const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...tests, "--no-file-parallelism", "--maxWorkers=1", "--silent", "--reporter=json", `--outputFile=${resolve(reportDirectory, "api-integration-results.json")}`], {
    cwd: process.cwd(), env: { ...process.env, TEST_DATABASE_URL: database.url }, stdio: "inherit", windowsHide: true
  });
  const code = await new Promise<number>((resolveExit, reject) => { child.once("error", reject); child.once("exit", (value) => resolveExit(value ?? 1)); });
  process.exitCode = code;
} finally { await database.teardown(); }
