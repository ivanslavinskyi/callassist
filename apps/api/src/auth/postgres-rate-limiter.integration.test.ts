import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { runMigrations } from "../db/migrate";
import { PostgresRateLimiter } from "./postgres-rate-limiter";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgresRateLimiter", () => {
  let first: PostgresRateLimiter;
  let second: PostgresRateLimiter;
  let inspection: postgres.Sql;

  beforeAll(async () => {
    await runMigrations(databaseUrl);
    first = new PostgresRateLimiter(databaseUrl!, Buffer.alloc(32, 11));
    second = new PostgresRateLimiter(databaseUrl!, Buffer.alloc(32, 11));
    inspection = postgres(databaseUrl!, { max: 1, onnotice: () => undefined });
  });

  afterAll(async () => {
    await Promise.all([
      first?.close(),
      second?.close(),
      inspection?.end()
    ]);
  });

  it("enforces one atomic budget across independent API instances", async () => {
    const suffix = randomUUID().replaceAll("-", "");
    const scope = `test:shared:${suffix}`;
    const privateIdentifier = `private.${suffix}@example.com`;
    const decisions = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      (index % 2 === 0 ? first : second).consume(
        scope,
        privateIdentifier,
        5,
        60_000
      )
    ));

    expect(decisions.filter(({ allowed }) => allowed)).toHaveLength(5);
    expect(decisions.filter(({ allowed }) => !allowed)).toHaveLength(15);
    expect(decisions.filter(({ allowed }) => !allowed).every(
      ({ retryAfterSeconds }) => retryAfterSeconds > 0
    )).toBe(true);

    const rows = await inspection<{
      scope: string;
      identifierHash: string;
      requestCount: number;
    }[]>`
      SELECT
        scope,
        identifier_hash AS "identifierHash",
        request_count AS "requestCount"
      FROM rate_limit_buckets
      WHERE scope = ${scope}
    `;
    expect(rows).toEqual([{
      scope,
      identifierHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      requestCount: 5
    }]);
    expect(JSON.stringify(rows)).not.toContain(privateIdentifier);

    const status = await second.getStatus();
    expect(status).toMatchObject({
      state: "healthy",
      mode: "postgres",
      shared: true
    });
    expect(status.denied).toBeGreaterThanOrEqual(15);
    expect(status.topDeniedScopes).toContainEqual({ scope, denied: 15 });
  });

  it("does not partially consume a multi-key budget when one key is denied", async () => {
    const suffix = randomUUID().replaceAll("-", "");
    const userScope = `test:atomic:user:${suffix}`;
    const ipScope = `test:atomic:ip:${suffix}`;
    const group = (ip: string) => [
      { scope: userScope, identifier: "user-1", limit: 1, windowMs: 60_000 },
      { scope: ipScope, identifier: ip, limit: 1, windowMs: 60_000 }
    ];

    expect((await first.consumeMany(group("192.0.2.10"))).allowed).toBe(true);
    expect((await second.consumeMany(group("192.0.2.11"))).allowed).toBe(false);
    expect((await first.consume(
      ipScope,
      "192.0.2.11",
      1,
      60_000
    )).allowed).toBe(true);

    const [row] = await inspection<{ count: number }[]>`
      SELECT count(*)::integer AS count
      FROM rate_limit_buckets
      WHERE scope = ${ipScope}
    `;
    expect(row?.count).toBe(2);
  });

  it("starts a fresh window after a durable bucket expires", async () => {
    const suffix = randomUUID().replaceAll("-", "");
    const scope = `test:expiry:${suffix}`;
    expect((await first.consume(scope, "user-1", 1, 60_000)).allowed).toBe(true);
    expect((await second.consume(scope, "user-1", 1, 60_000)).allowed).toBe(false);

    await inspection`
      UPDATE rate_limit_buckets
      SET
        created_at = clock_timestamp() - interval '2 seconds',
        reset_at = clock_timestamp() - interval '1 second'
      WHERE scope = ${scope}
    `;
    expect((await second.consume(scope, "user-1", 1, 60_000)).allowed).toBe(true);
  });
});
