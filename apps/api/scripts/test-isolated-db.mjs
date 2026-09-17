import '../src/config/load-env.ts';
import { spawn } from 'node:child_process';
import { isolatedTestDatabase } from '../src/db/isolated-test-database.ts';

// All fixtures go to a fresh *_test database. Existing databases are untouched.
const fixture = isolatedTestDatabase();
try {
  await fixture.setup();
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(2)], {
      env: { ...process.env, TEST_DATABASE_URL: fixture.url }, stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('exit', code => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
} finally { await fixture.teardown(); }
