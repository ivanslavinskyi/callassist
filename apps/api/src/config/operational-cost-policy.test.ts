import { describe, expect, it } from "vitest";
import { operationalCostPolicyFromEnv } from "./operational-cost-policy";

describe("operational cost policy", () => {
  it("keeps cost explicitly unavailable when no rates are configured", () => {
    expect(operationalCostPolicyFromEnv({})).toEqual({
      pricingVersion: null,
      telephonyUsdMicrosPerMinute: null,
      realtimeUsdMicrosPerMinute: null,
      transcriptionUsdMicrosPerMinute: null
    });
  });

  it("accepts versioned integer micro-dollar rates", () => {
    expect(operationalCostPolicyFromEnv({
      ADMIN_COST_PRICING_VERSION: "2026-08-support-estimate",
      ADMIN_COST_TELEPHONY_USD_MICROS_PER_MINUTE: "14000",
      ADMIN_COST_REALTIME_USD_MICROS_PER_MINUTE: "250000",
      ADMIN_COST_TRANSCRIPTION_USD_MICROS_PER_MINUTE: "6000"
    })).toEqual({
      pricingVersion: "2026-08-support-estimate",
      telephonyUsdMicrosPerMinute: 14000,
      realtimeUsdMicrosPerMinute: 250000,
      transcriptionUsdMicrosPerMinute: 6000
    });
  });

  it("rejects unversioned or fractional rates", () => {
    expect(() => operationalCostPolicyFromEnv({
      ADMIN_COST_TELEPHONY_USD_MICROS_PER_MINUTE: "14000"
    })).toThrow("ADMIN_COST_PRICING_VERSION");
    expect(() => operationalCostPolicyFromEnv({
      ADMIN_COST_PRICING_VERSION: "v1",
      ADMIN_COST_REALTIME_USD_MICROS_PER_MINUTE: "1.5"
    })).toThrow("non-negative integer");
    expect(() => operationalCostPolicyFromEnv({
      ADMIN_COST_PRICING_VERSION: "x".repeat(81)
    })).toThrow("at most 80 characters");
  });
});
