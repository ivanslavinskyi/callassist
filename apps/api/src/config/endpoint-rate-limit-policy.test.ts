import { describe, expect, it } from "vitest";
import { endpointRateLimitPolicyFromEnv } from "./endpoint-rate-limit-policy";

describe("endpoint rate-limit policy", () => {
  it("uses public-beta defaults with a five-times larger shared IP budget", () => {
    expect(endpointRateLimitPolicyFromEnv({})).toEqual({
      briefPreparation: { userLimit: 15, ipLimit: 75, windowMs: 3_600_000 },
      callStart: { userLimit: 10, ipLimit: 50, windowMs: 900_000 },
      promoRedemption: { userLimit: 10, ipLimit: 50, windowMs: 3_600_000 },
      recordingDownload: { userLimit: 30, ipLimit: 150, windowMs: 3_600_000 },
      transcriptionRetry: { userLimit: 5, ipLimit: 25, windowMs: 86_400_000 },
      dataExport: { userLimit: 2, ipLimit: 10, windowMs: 86_400_000 },
      callDataDeletion: { userLimit: 5, ipLimit: 25, windowMs: 86_400_000 },
      accountDeletion: { userLimit: 3, ipLimit: 15, windowMs: 86_400_000 }
    });
  });

  it("accepts positive overrides and rejects unsafe values", () => {
    expect(endpointRateLimitPolicyFromEnv({
      API_RATE_LIMIT_CALL_START_PER_15_MINUTES: "4"
    }).callStart).toEqual({ userLimit: 4, ipLimit: 20, windowMs: 900_000 });
    expect(() => endpointRateLimitPolicyFromEnv({
      API_RATE_LIMIT_TRANSCRIPTION_RETRY_PER_DAY: "0"
    })).toThrow("API_RATE_LIMIT_TRANSCRIPTION_RETRY_PER_DAY");
    expect(endpointRateLimitPolicyFromEnv({
      API_RATE_LIMIT_DATA_EXPORT_PER_DAY: "3"
    }).dataExport).toEqual({
      userLimit: 3,
      ipLimit: 15,
      windowMs: 86_400_000
    });
    expect(() => endpointRateLimitPolicyFromEnv({
      API_RATE_LIMIT_CALL_DATA_DELETION_PER_DAY: "0"
    })).toThrow("API_RATE_LIMIT_CALL_DATA_DELETION_PER_DAY");
  });
});
