import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { telemetryExportInputSchema, type TelemetryExportInput } from "@callassist/contracts";
import { resolveExportPeriod, zurichMidnight } from "./period";

const input = (preset: TelemetryExportInput["preset"], dates = {}): TelemetryExportInput => ({ requestId: randomUUID(), reason: "Quality analysis", preset, timezone: "Europe/Zurich", ...dates });
describe("telemetry export periods", () => {
  it("uses Zurich days and half-open bounds", () => {
    expect(resolveExportPeriod(input("yesterday"), new Date("2026-09-22T10:00:00Z"))).toMatchObject({ from: "2026-09-20T22:00:00.000Z", to: "2026-09-21T22:00:00.000Z" });
    expect(resolveExportPeriod(input("today"), new Date("2026-09-21T23:00:00Z"))).toMatchObject({ from: "2026-09-21T22:00:00.000Z", to: "2026-09-21T23:00:00.000Z" });
  });
  it("handles 23/25-hour days, leap years and previous month", () => {
    expect(Date.parse(zurichMidnight("2026-03-30")) - Date.parse(zurichMidnight("2026-03-29"))).toBe(23 * 3600000);
    expect(Date.parse(zurichMidnight("2026-10-26")) - Date.parse(zurichMidnight("2026-10-25"))).toBe(25 * 3600000);
    expect(resolveExportPeriod(input("previousMonth"), new Date("2028-03-05T12:00:00Z"))).toMatchObject({ from: "2028-01-31T23:00:00.000Z", to: "2028-02-29T23:00:00.000Z" });
  });
  it("counts local calendar days and limits custom ranges", () => {
    expect(resolveExportPeriod(input("last7"), new Date("2026-09-22T10:00:00Z")).from).toBe("2026-09-15T22:00:00.000Z");
    expect(resolveExportPeriod(input("last30"), new Date("2026-09-22T10:00:00Z")).from).toBe("2026-08-23T22:00:00.000Z");
    expect(() => resolveExportPeriod(input("custom", { dateFrom: "2026-01-01", dateTo: "2026-02-01" }))).toThrow("EXPORT_INVALID_PERIOD");
    expect(resolveExportPeriod(input("custom", { dateFrom: "2026-10-01", dateTo: "2026-10-31" })).to).toBe("2026-10-31T23:00:00.000Z");
  });
  it("rejects invalid or ambiguous input", () => {
    expect(telemetryExportInputSchema.safeParse(input("custom", { dateFrom: "2026-02-30", dateTo: "2026-03-01" })).success).toBe(false);
    expect(telemetryExportInputSchema.safeParse(input("today", { dateFrom: "2026-01-01" })).success).toBe(false);
    expect(telemetryExportInputSchema.safeParse({ ...input("today"), timezone: "UTC" }).success).toBe(false);
    expect(telemetryExportInputSchema.safeParse({ ...input("today"), reason: " " }).success).toBe(false);
  });
});
