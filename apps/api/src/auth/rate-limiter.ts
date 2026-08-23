import { createHash } from "node:crypto";

type Bucket = { count: number; resetAt: number };

export type RateLimitEntry = {
  scope: string;
  identifier: string;
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export type RateLimitStatus = {
  state: "healthy" | "unavailable";
  mode: "memory" | "postgres";
  shared: boolean;
  activeBuckets: number | null;
  metricsSince: string | null;
  allowed: number | null;
  denied: number | null;
  topDeniedScopes: Array<{ scope: string; denied: number }>;
};

export interface RateLimiter {
  readonly mode: "memory" | "postgres";
  readonly shared: boolean;
  consume(
    scope: string,
    identifier: string,
    limit: number,
    windowMs: number
  ): Promise<RateLimitResult>;
  consumeMany(entries: RateLimitEntry[]): Promise<RateLimitResult>;
  getStatus(): Promise<RateLimitStatus>;
  close(): Promise<void>;
}

export class RateLimiterUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(
      "RATE_LIMIT_UNAVAILABLE",
      options?.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "RateLimiterUnavailableError";
  }
}

export function parseRateLimitHashKey(
  value: string | undefined,
  developmentFallback?: string
) {
  const encoded = value?.trim() || developmentFallback?.trim();
  const decoded = encoded && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    ? Buffer.from(encoded, "base64")
    : null;
  const canonical = decoded
    ? decoded.toString("base64").replace(/=+$/, "") ===
      encoded!.replace(/=+$/, "")
    : false;
  if (!decoded || decoded.length !== 32 || !canonical) {
    throw new Error("RATE_LIMIT_HASH_KEY must be a base64-encoded 32-byte key");
  }
  return decoded;
}

export class ApplicationRateLimiter implements RateLimiter {
  readonly mode = "memory" as const;
  readonly shared = false;
  readonly #buckets = new Map<string, Bucket>();
  readonly #metrics = new Map<string, { allowed: number; denied: number }>();
  readonly #now: () => number;
  readonly #maxBuckets: number;
  readonly #startedAt: number;

  constructor(now: () => number = Date.now, maxBuckets = 10_000) {
    if (!Number.isSafeInteger(maxBuckets) || maxBuckets <= 0) {
      throw new Error("maxBuckets must be a positive integer");
    }
    this.#now = now;
    this.#maxBuckets = maxBuckets;
    this.#startedAt = now();
  }

  async consume(
    scope: string,
    identifier: string,
    limit: number,
    windowMs: number
  ) {
    return this.consumeMany([{ scope, identifier, limit, windowMs }]);
  }

  async consumeMany(entries: RateLimitEntry[]) {
    validateRateLimitEntries(entries);
    const now = this.#now();
    const pending = entries.map((entry) => {
      const key = hashEphemeralIdentifier(entry.scope, entry.identifier);
      const existing = this.#buckets.get(key);
      const bucket = !existing || existing.resetAt <= now
        ? { count: 0, resetAt: now + entry.windowMs }
        : existing;
      return { entry, key, bucket };
    });
    let newKeys = new Set(
      pending
        .filter(({ key }) => !this.#buckets.has(key))
        .map(({ key }) => key)
    );
    if (this.#buckets.size + newKeys.size > this.#maxBuckets) {
      this.#discardExpired(now);
      newKeys = new Set(
        pending
          .filter(({ key }) => !this.#buckets.has(key))
          .map(({ key }) => key)
      );
      if (this.#buckets.size + newKeys.size > this.#maxBuckets) {
        const earliestReset = Math.min(
          ...[...this.#buckets.values()].map(({ resetAt }) => resetAt)
        );
        const result = {
          allowed: false as const,
          retryAfterSeconds: Number.isFinite(earliestReset)
            ? Math.max(1, Math.ceil((earliestReset - now) / 1_000))
            : 1
        };
        this.#record(entries, false);
        return result;
      }
    }
    const denied = pending.filter(({ entry, bucket }) =>
      bucket.count >= entry.limit
    );
    if (denied.length > 0) {
      const result = {
        allowed: false as const,
        retryAfterSeconds: Math.max(...denied.map(({ bucket }) =>
          Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000))
        ))
      };
      this.#record(entries, false);
      return result;
    }
    for (const { key, bucket } of pending) {
      bucket.count += 1;
      this.#buckets.set(key, bucket);
    }
    this.#record(entries, true);
    return { allowed: true as const, retryAfterSeconds: 0 };
  }

  async getStatus(): Promise<RateLimitStatus> {
    const now = this.#now();
    this.#discardExpired(now);
    const entries = [...this.#metrics.entries()];
    return {
      state: "healthy",
      mode: this.mode,
      shared: this.shared,
      activeBuckets: this.#buckets.size,
      metricsSince: new Date(this.#startedAt).toISOString(),
      allowed: entries.reduce((total, [, value]) => total + value.allowed, 0),
      denied: entries.reduce((total, [, value]) => total + value.denied, 0),
      topDeniedScopes: entries
        .filter(([, value]) => value.denied > 0)
        .map(([scope, value]) => ({ scope, denied: value.denied }))
        .sort((left, right) =>
          right.denied - left.denied || left.scope.localeCompare(right.scope)
        )
        .slice(0, 10)
    };
  }

  async close() {}

  #discardExpired(now: number) {
    for (const [key, bucket] of this.#buckets) {
      if (bucket.resetAt <= now) this.#buckets.delete(key);
    }
  }

  #record(entries: RateLimitEntry[], allowed: boolean) {
    for (const scope of new Set(entries.map(({ scope }) => scope))) {
      const metric = this.#metrics.get(scope) ?? { allowed: 0, denied: 0 };
      metric[allowed ? "allowed" : "denied"] += 1;
      this.#metrics.set(scope, metric);
    }
  }
}

export function validateRateLimitEntries(entries: RateLimitEntry[]) {
  if (entries.length < 1 || entries.length > 16) {
    throw new Error("Rate-limit groups must contain between 1 and 16 entries");
  }
  const keys = new Set<string>();
  for (const entry of entries) {
    if (!/^[a-z0-9][a-z0-9:_-]{0,119}$/.test(entry.scope)) {
      throw new Error("Rate-limit scope is invalid");
    }
    if (!entry.identifier || entry.identifier.length > 1_000) {
      throw new Error("Rate-limit identifier is invalid");
    }
    if (
      !Number.isSafeInteger(entry.limit) ||
      entry.limit < 1 ||
      entry.limit > 1_000_000
    ) {
      throw new Error("Rate-limit value is invalid");
    }
    if (
      !Number.isSafeInteger(entry.windowMs) ||
      entry.windowMs < 1_000 ||
      entry.windowMs > 7 * 24 * 60 * 60 * 1_000
    ) {
      throw new Error("Rate-limit window is invalid");
    }
    const key = `${entry.scope}\0${entry.identifier}`;
    if (keys.has(key)) throw new Error("Rate-limit group contains a duplicate");
    keys.add(key);
  }
}

export function hashEphemeralIdentifier(scope: string, identifier: string) {
  return createHash("sha256")
    .update(scope)
    .update("\0")
    .update(identifier)
    .digest("base64url");
}
