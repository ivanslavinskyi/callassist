import { createHash, createHmac } from "node:crypto";
import postgres from "postgres";
import {
  RateLimiterUnavailableError,
  validateRateLimitEntries,
  type RateLimitEntry,
  type RateLimitResult,
  type RateLimiter,
  type RateLimitStatus
} from "./rate-limiter";

type DatabaseDate = Date | string;

type BucketRow = {
  scope: string;
  identifierHash: string;
  requestCount: number;
  resetAt: DatabaseDate;
};

type PreparedEntry = RateLimitEntry & {
  identifierHash: string;
  lockOrder: string;
  advisoryKey: string;
};

const bucketCapacityAdvisoryKey = advisoryKey(
  createHash("sha256").update("callassist:rate-limit-capacity:v1").digest("hex")
);
const metricsRetentionMs = 30 * 24 * 60 * 60 * 1_000;

export class PostgresRateLimiter implements RateLimiter {
  readonly mode = "postgres" as const;
  readonly shared = true;
  readonly #sql: postgres.Sql;
  readonly #hashKey: Buffer;
  readonly #maxBuckets: number;

  constructor(databaseUrl: string, hashKey: Buffer, maxBuckets = 100_000) {
    if (hashKey.length !== 32) {
      throw new Error("Rate-limit hash key must contain exactly 32 bytes");
    }
    if (!Number.isSafeInteger(maxBuckets) || maxBuckets <= 0) {
      throw new Error("maxBuckets must be a positive integer");
    }
    this.#sql = postgres(databaseUrl, { max: 5, onnotice: () => undefined });
    this.#hashKey = Buffer.from(hashKey);
    this.#maxBuckets = maxBuckets;
  }

  async consume(
    scope: string,
    identifier: string,
    limit: number,
    windowMs: number
  ) {
    return this.consumeMany([{ scope, identifier, limit, windowMs }]);
  }

  async consumeMany(entries: RateLimitEntry[]): Promise<RateLimitResult> {
    validateRateLimitEntries(entries);
    const prepared = entries.map((entry) => this.#prepare(entry));
    try {
      return await this.#sql.begin(async (transaction) => {
        for (const entry of [...prepared].sort((left, right) =>
          left.lockOrder.localeCompare(right.lockOrder)
        )) {
          await transaction`
            SELECT pg_advisory_xact_lock(${entry.advisoryKey}::bigint)
          `;
        }
        const [clock] = await transaction<{ now: DatabaseDate }[]>`
          SELECT clock_timestamp() AS now
        `;
        const now = toDate(clock!.now);

        const rows = new Map<string, BucketRow>();
        for (const entry of prepared) {
          const [row] = await transaction<BucketRow[]>`
            SELECT
              scope,
              identifier_hash AS "identifierHash",
              request_count AS "requestCount",
              reset_at AS "resetAt"
            FROM rate_limit_buckets
            WHERE scope = ${entry.scope}
              AND identifier_hash = ${entry.identifierHash}
            FOR UPDATE
          `;
          if (row) rows.set(bucketKey(entry), row);
        }

        const denied = prepared.filter((entry) => {
          const row = rows.get(bucketKey(entry));
          return row && toDate(row.resetAt) > now && row.requestCount >= entry.limit;
        });
        if (denied.length > 0) {
          const retryAfterSeconds = Math.max(...denied.map((entry) =>
            retryAfter(toDate(rows.get(bucketKey(entry))!.resetAt), now)
          ));
          await this.#recordMetrics(transaction, prepared, false, now);
          return { allowed: false, retryAfterSeconds };
        }

        const needed = prepared.filter((entry) => {
          const row = rows.get(bucketKey(entry));
          return !row || toDate(row.resetAt) <= now;
        }).length;
        if (needed > 0) {
          await transaction`
            SELECT pg_advisory_xact_lock(${bucketCapacityAdvisoryKey}::bigint)
          `;
          await transaction`
            DELETE FROM rate_limit_buckets WHERE reset_at <= ${now}
          `;
          const [capacity] = await transaction<{ count: number }[]>`
            SELECT count(*)::integer AS count FROM rate_limit_buckets
          `;
          if ((capacity?.count ?? 0) + needed > this.#maxBuckets) {
            const [earliest] = await transaction<{ resetAt: DatabaseDate | null }[]>`
              SELECT min(reset_at) AS "resetAt" FROM rate_limit_buckets
            `;
            await this.#recordMetrics(transaction, prepared, false, now);
            return {
              allowed: false,
              retryAfterSeconds: earliest?.resetAt
                ? retryAfter(toDate(earliest.resetAt), now)
                : 1
            };
          }
        }

        for (const entry of prepared) {
          const resetAt = new Date(now.getTime() + entry.windowMs);
          await transaction`
            INSERT INTO rate_limit_buckets (
              scope, identifier_hash, request_count, request_limit,
              window_ms, reset_at, created_at, updated_at
            ) VALUES (
              ${entry.scope}, ${entry.identifierHash}, 1, ${entry.limit},
              ${entry.windowMs}, ${resetAt}, ${now}, ${now}
            )
            ON CONFLICT (scope, identifier_hash) DO UPDATE SET
              request_count = CASE
                WHEN rate_limit_buckets.reset_at <= ${now} THEN 1
                ELSE rate_limit_buckets.request_count + 1
              END,
              request_limit = EXCLUDED.request_limit,
              window_ms = EXCLUDED.window_ms,
              reset_at = CASE
                WHEN rate_limit_buckets.reset_at <= ${now} THEN EXCLUDED.reset_at
                ELSE rate_limit_buckets.reset_at
              END,
              updated_at = ${now}
          `;
        }
        await this.#recordMetrics(transaction, prepared, true, now);
        return { allowed: true, retryAfterSeconds: 0 };
      });
    } catch (error) {
      if (error instanceof RateLimiterUnavailableError) throw error;
      throw new RateLimiterUnavailableError({ cause: error });
    }
  }

  async getStatus(): Promise<RateLimitStatus> {
    try {
      const [clock] = await this.#sql<{ now: DatabaseDate }[]>`
        SELECT clock_timestamp() AS now
      `;
      const now = toDate(clock!.now);
      const since = new Date(now);
      since.setUTCMinutes(0, 0, 0);
      since.setUTCHours(since.getUTCHours() - 23);
      const [[buckets], [totals], deniedScopes] = await Promise.all([
        this.#sql<{ count: number }[]>`
          SELECT count(*)::integer AS count
          FROM rate_limit_buckets
          WHERE reset_at > ${now}
        `,
        this.#sql<{ allowed: string; denied: string }[]>`
          SELECT
            COALESCE(sum(allowed_count), 0)::text AS allowed,
            COALESCE(sum(denied_count), 0)::text AS denied
          FROM rate_limit_hourly_metrics
          WHERE hour >= ${since}
        `,
        this.#sql<{ scope: string; denied: string }[]>`
          SELECT scope, sum(denied_count)::text AS denied
          FROM rate_limit_hourly_metrics
          WHERE hour >= ${since}
            AND denied_count > 0
          GROUP BY scope
          ORDER BY sum(denied_count) DESC, scope ASC
          LIMIT 10
        `
      ]);
      return {
        state: "healthy",
        mode: this.mode,
        shared: this.shared,
        activeBuckets: buckets?.count ?? 0,
        metricsSince: since.toISOString(),
        allowed: safeCount(totals?.allowed),
        denied: safeCount(totals?.denied),
        topDeniedScopes: deniedScopes.map((row) => ({
          scope: row.scope,
          denied: safeCount(row.denied)
        }))
      };
    } catch (error) {
      throw new RateLimiterUnavailableError({ cause: error });
    }
  }

  async close() {
    await this.#sql.end({ timeout: 5 });
  }

  #prepare(entry: RateLimitEntry): PreparedEntry {
    const identifierHash = createHmac("sha256", this.#hashKey)
      .update(entry.scope)
      .update("\0")
      .update(entry.identifier)
      .digest("hex");
    const lockOrder = createHash("sha256")
      .update(entry.scope)
      .update("\0")
      .update(identifierHash)
      .digest("hex");
    return {
      ...entry,
      identifierHash,
      lockOrder,
      advisoryKey: advisoryKey(lockOrder)
    };
  }

  async #recordMetrics(
    transaction: postgres.TransactionSql,
    entries: PreparedEntry[],
    allowed: boolean,
    now: Date
  ) {
    const hour = new Date(now);
    hour.setUTCMinutes(0, 0, 0);
    for (const scope of [...new Set(entries.map(({ scope }) => scope))].sort()) {
      await transaction`
        INSERT INTO rate_limit_hourly_metrics (
          hour, scope, allowed_count, denied_count
        ) VALUES (
          ${hour}, ${scope}, ${allowed ? 1 : 0}, ${allowed ? 0 : 1}
        )
        ON CONFLICT (hour, scope) DO UPDATE SET
          allowed_count = rate_limit_hourly_metrics.allowed_count +
            EXCLUDED.allowed_count,
          denied_count = rate_limit_hourly_metrics.denied_count +
            EXCLUDED.denied_count
      `;
    }
    await transaction`
      DELETE FROM rate_limit_hourly_metrics
      WHERE hour < ${new Date(now.getTime() - metricsRetentionMs)}
    `;
  }
}

function bucketKey(entry: Pick<PreparedEntry, "scope" | "identifierHash">) {
  return `${entry.scope}\0${entry.identifierHash}`;
}

function toDate(value: DatabaseDate) {
  return value instanceof Date ? value : new Date(value);
}

function retryAfter(resetAt: Date, now: Date) {
  return Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1_000));
}

function safeCount(value: string | number | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : Number.MAX_SAFE_INTEGER;
}

function advisoryKey(hex: string) {
  const unsigned = BigInt(`0x${hex.slice(0, 16)}`);
  const signed = unsigned > 0x7fff_ffff_ffff_ffffn
    ? unsigned - 0x1_0000_0000_0000_0000n
    : unsigned;
  return signed.toString();
}
