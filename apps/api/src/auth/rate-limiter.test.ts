import { describe, expect, it } from "vitest";
import { ApplicationRateLimiter } from "./rate-limiter";

describe("ApplicationRateLimiter", () => {
  it("limits an identifier and resets after its window", () => {
    let now = 1_000;
    const limiter = new ApplicationRateLimiter(() => now);
    expect(limiter.consume("verification", "+41710000000", 2, 10_000).allowed)
      .toBe(true);
    expect(limiter.consume("verification", "+41710000000", 2, 10_000).allowed)
      .toBe(true);
    expect(limiter.consume("verification", "+41710000000", 2, 10_000)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 10
    });
    now = 11_000;
    expect(limiter.consume("verification", "+41710000000", 2, 10_000).allowed)
      .toBe(true);
  });

  it("does not consume any bucket when one entry in a group is denied", () => {
    const limiter = new ApplicationRateLimiter(() => 1_000);
    const group = (ip: string) => [
      { scope: "start:user", identifier: "user-1", limit: 1, windowMs: 10_000 },
      { scope: "start:ip", identifier: ip, limit: 1, windowMs: 10_000 }
    ];
    expect(limiter.consumeMany(group("192.0.2.1")).allowed).toBe(true);
    expect(limiter.consumeMany(group("192.0.2.2")).allowed).toBe(false);
    expect(limiter.consume("start:ip", "192.0.2.2", 1, 10_000).allowed)
      .toBe(true);
  });

  it("fails closed at its bucket cap and recovers after expiry", () => {
    let now = 1_000;
    const limiter = new ApplicationRateLimiter(() => now, 1);
    expect(limiter.consume("scope", "first", 2, 10_000).allowed).toBe(true);
    expect(limiter.consume("scope", "second", 2, 10_000)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 10
    });
    now = 11_000;
    expect(limiter.consume("scope", "second", 2, 10_000).allowed).toBe(true);
  });
});
