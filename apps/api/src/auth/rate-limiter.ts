import { createHash } from "node:crypto";

type Bucket = { count: number; resetAt: number };

export class ApplicationRateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  consume(scope: string, identifier: string, limit: number, windowMs: number) {
    const now = this.#now();
    const key = `${scope}:${hashIdentifier(identifier)}`;
    const existing = this.#buckets.get(key);
    const bucket = !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : existing;
    if (bucket.count >= limit) {
      return { allowed: false as const, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)) };
    }
    bucket.count += 1;
    this.#buckets.set(key, bucket);
    if (this.#buckets.size > 10_000) this.#discardExpired(now);
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
