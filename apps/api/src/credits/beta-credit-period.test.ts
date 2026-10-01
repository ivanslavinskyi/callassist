import { describe, expect, it } from "vitest";
import { betaCreditPeriod } from "./beta-credit-period";

describe("UTC beta credit periods", () => {
  it.each([
    ["day", "2028-02-29T23:59:59.999Z", "2028-02-29T00:00:00.000Z", "2028-03-01T00:00:00.000Z"],
    ["week", "2027-01-03T22:00:00Z", "2026-12-28T00:00:00.000Z", "2027-01-04T00:00:00.000Z"],
    ["month", "2028-02-29T23:00:00Z", "2028-02-01T00:00:00.000Z", "2028-03-01T00:00:00.000Z"],
    ["day", "2026-10-25T02:30:00+01:00", "2026-10-25T00:00:00.000Z", "2026-10-26T00:00:00.000Z"]
  ] as const)("bounds %s at %s", (period, now, startsAt, endsAt) => {
    expect(betaCreditPeriod(period, new Date(now))).toEqual({ startsAt, endsAt });
  });
  it("does not manufacture a reset for lifetime credits", () => expect(betaCreditPeriod("lifetime", new Date())).toBeNull());
});
