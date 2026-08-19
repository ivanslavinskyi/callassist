import { createHash } from "node:crypto";

type Bucket = { count: number; resetAt: number };

export type RateLimitEntry = {
  scope: string;
  identifier: string;
  limit: number;
  windowMs: number;
};

export class ApplicationRateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #now: () => number;
  readonly #maxBuckets: number;

  constructor(now: () => number = Date.now, maxBuckets = 10_000) {
    if (!Number.isSafeInteger(maxBuckets) || maxBuckets <= 0) {
      throw new Error("maxBuckets must be a positive integer");
    }
    this.#now = now;
    this.#maxBuckets = maxBuckets;
  }

  consume(scope: string, identifier: string, limit: number, windowMs: number) {
    return this.consumeMany([{ scope, identifier, limit, windowMs }]);
  }

  consumeMany(entries: RateLimitEntry[]) {
    const now = this.#now();
    const pending = entries.map((entry) => {
      const key = `${entry.scope}:${hashIdentifier(entry.identifier)}`;
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
        return {
          allowed: false as const,
          retryAfterSeconds: Number.isFinite(earliestReset)
            ? Math.max(1, Math.ceil((earliestReset - now) / 1_000))
            : 1
        };
      }
    }
    const denied = pending.filter(({ entry, bucket }) =>
      bucket.count >= entry.limit
    );
    if (denied.length > 0) {
      return {
        allowed: false as const,
        retryAfterSeconds: Math.max(...denied.map(({ bucket }) =>
          Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000))
        ))
      };
    }
    for (const { key, bucket } of pending) {
      bucket.count += 1;
      this.#buckets.set(key, bucket);
    }
    return { allowed: true as const, retryAfterSeconds: 0 };
  }

  #discardExpired(now: number) {
    for (const [key, bucket] of this.#buckets) {
      if (bucket.resetAt <= now) this.#buckets.delete(key);
    }
  }
}

function hashIdentifier(identifier: string) {
  return createHash("sha256").update(identifier).digest("base64url");
}
