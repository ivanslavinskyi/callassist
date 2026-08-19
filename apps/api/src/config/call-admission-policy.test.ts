import { describe, expect, it } from "vitest";
import { callAdmissionPolicyFromEnv } from "./call-admission-policy";

describe("call admission policy", () => {
  it("uses conservative public-beta defaults", () => {
    expect(callAdmissionPolicyFromEnv({})).toEqual({
      maxStartsPerHour: 3,
      maxStartsPerDay: 10,
      maxStartsPerRecipientPerDay: 2,
      maxDurationSeconds: 900
    });
  });

  it("accepts positive overrides and rejects unsafe values", () => {
    expect(callAdmissionPolicyFromEnv({
      CALL_MAX_STARTS_PER_HOUR: "4",
      CALL_MAX_STARTS_PER_DAY: "12",
      CALL_MAX_STARTS_PER_RECIPIENT_PER_DAY: "3",
      CALL_MAX_DURATION_SECONDS: "600"
    })).toEqual({
      maxStartsPerHour: 4,
      maxStartsPerDay: 12,
      maxStartsPerRecipientPerDay: 3,
      maxDurationSeconds: 600
    });
    expect(() => callAdmissionPolicyFromEnv({
      CALL_MAX_STARTS_PER_HOUR: "0"
    })).toThrow("CALL_MAX_STARTS_PER_HOUR");
  });
});
