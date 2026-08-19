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
});
