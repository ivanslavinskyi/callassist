import { describe, expect, it } from "vitest";
import {
  ApplicationRateLimiter,
  parseRateLimitHashKey
} from "./rate-limiter";

describe("ApplicationRateLimiter", () => {
  it("limits an identifier and resets after its window", async () => {
    let now = 1_000;
    const limiter = new ApplicationRateLimiter(() => now);
    expect((await limiter.consume("verification", "+41710000000", 2, 10_000)).allowed)
      .toBe(true);
    expect((await limiter.consume("verification", "+41710000000", 2, 10_000)).allowed)
      .toBe(true);
    expect(await limiter.consume(
      "verification",
      "+41710000000",
      2,
      10_000
    )).toMatchObject({
      allowed: false,
      retryAfterSeconds: 10
    });
    now = 11_000;
    expect((await limiter.consume("verification", "+41710000000", 2, 10_000)).allowed)
      .toBe(true);
  });

  it("does not consume any bucket when one entry in a group is denied", async () => {
    const limiter = new ApplicationRateLimiter(() => 1_000);
    const group = (ip: string) => [
      { scope: "start:user", identifier: "user-1", limit: 1, windowMs: 10_000 },
      { scope: "start:ip", identifier: ip, limit: 1, windowMs: 10_000 }
    ];
    expect((await limiter.consumeMany(group("192.0.2.1"))).allowed).toBe(true);
    expect((await limiter.consumeMany(group("192.0.2.2"))).allowed).toBe(false);
    expect((await limiter.consume("start:ip", "192.0.2.2", 1, 10_000)).allowed)
      .toBe(true);
  });

  it("fails closed at its bucket cap and recovers after expiry", async () => {
    let now = 1_000;
    const limiter = new ApplicationRateLimiter(() => now, 1);
    expect((await limiter.consume("scope", "first", 2, 10_000)).allowed)
      .toBe(true);
    expect(await limiter.consume("scope", "second", 2, 10_000)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 10
    });
    now = 11_000;
    expect((await limiter.consume("scope", "second", 2, 10_000)).allowed)
      .toBe(true);
  });

  it("reports only aggregate scope metrics", async () => {
    const limiter = new ApplicationRateLimiter(() => 1_000);
    await limiter.consume("login:email", "private@example.com", 1, 60_000);
    await limiter.consume("login:email", "private@example.com", 1, 60_000);

    const status = await limiter.getStatus();
    expect(status).toMatchObject({
      state: "healthy",
      mode: "memory",
      shared: false,
      activeBuckets: 1,
      allowed: 1,
      denied: 1,
      topDeniedScopes: [{ scope: "login:email", denied: 1 }]
    });
    expect(JSON.stringify(status)).not.toContain("private@example.com");
  });

  it("rejects malformed and duplicate budget entries", async () => {
    const limiter = new ApplicationRateLimiter();
    await expect(limiter.consume("Invalid scope", "user", 1, 60_000))
      .rejects.toThrow("scope is invalid");
    await expect(limiter.consumeMany([
      { scope: "login:user", identifier: "user", limit: 1, windowMs: 60_000 },
      { scope: "login:user", identifier: "user", limit: 2, windowMs: 60_000 }
    ])).rejects.toThrow("contains a duplicate");
  });
});

describe("parseRateLimitHashKey", () => {
  it("accepts only canonical base64-encoded 32-byte keys", () => {
    const encoded = Buffer.alloc(32, 9).toString("base64");
    expect(parseRateLimitHashKey(encoded)).toEqual(Buffer.alloc(32, 9));
    expect(() => parseRateLimitHashKey("not-base64"))
      .toThrow("base64-encoded 32-byte key");
    expect(() => parseRateLimitHashKey(Buffer.alloc(31).toString("base64")))
      .toThrow("base64-encoded 32-byte key");
  });
});
