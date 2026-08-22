import { describe, expect, it } from "vitest";
import { serviceLivenessSchema, serviceReadinessSchema } from "./health";

describe("service health contracts", () => {
  it("keeps liveness dependency-free and readiness explicit", () => {
    expect(serviceLivenessSchema.parse({ status: "alive" })).toEqual({
      status: "alive"
    });
    expect(serviceReadinessSchema.parse({
      status: "not_ready",
      checks: { database: "unavailable" }
    })).toEqual({
      status: "not_ready",
      checks: { database: "unavailable" }
    });
  });

  it("rejects operational and provider detail", () => {
    expect(serviceReadinessSchema.safeParse({
      status: "ready",
      checks: { database: "ready" },
      databaseUrl: "postgres://private"
    }).success).toBe(false);
  });
});
