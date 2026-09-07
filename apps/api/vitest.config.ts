import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // PostgreSQL integration suites create independent repositories and run
    // migration/setup work. Bounding file concurrency avoids starving Fastify
    // and database assertions on high-core developer and CI hosts.
    maxWorkers: 4,
    testTimeout: 10_000,
    hookTimeout: 30_000
  }
});
