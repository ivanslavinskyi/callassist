import { describe, expect, it } from "vitest";
import type { AppointmentAuthorization } from "@callassist/contracts";
import { evaluateAppointmentCalendar } from "./appointment-calendar";
import { validateAppointmentProposal } from "../realtime/appointment-authorization";

const authorization: AppointmentAuthorization = { operation: "book", serviceDescription: "Sports massage", providerScope: "called_recipient",
  timeZone: "Europe/Zurich", windows: [{ date: "2026-10-03", startTime: "09:00", endTime: "18:00" }],
  selection: "first_matching", maxAppointments: 1, financialPolicy: "no_new_financial_terms" };
const candidate = { date: "2026-10-03", startTime: "11:00", timeZone: "Europe/Zurich" };
const referenceAt = "2026-10-01T08:08:50.246Z";
const evaluate = (changes = {}) => evaluateAppointmentCalendar({ authorization, candidate, referenceAt, ...changes });

describe("frozen appointment calendar", () => {
  it("accepts October 3 from an October 1 call without computing the period again", () => {
    expect(evaluate()).toEqual({ eligibility: "within", reason: "exact_window", windowIndex: 0,
      startsAt: "2026-10-03T09:00:00.000Z", pastAtReference: false });
    expect(validateAppointmentProposal({ authorization, proposal: { ...candidate, operation: "book", serviceMatches: true,
      recipientMatches: true, requiresPaymentOrNewTerms: false, detailsConfirmed: true }, now: new Date(referenceAt) })).toMatchObject({ ok: true, startsAt: evaluate().startsAt });
  });
  it.each(["09:00", "18:00"])("includes start-time boundary %s", startTime => {
    expect(evaluate({ candidate: { ...candidate, startTime } }).eligibility).toBe("within");
  });
  it.each([{ date: "2026-10-02" }, { date: "2026-10-16" }, { startTime: "08:59" }, { startTime: "18:01" }])("rejects an excluded slot %j", changes => {
    expect(evaluate({ candidate: { ...candidate, ...changes } })).toMatchObject({ eligibility: "outside", reason: "outside_window" });
  });
  it.each([
    [{ date: null }, "missing_date"], [{ startTime: null }, "missing_time"], [{ date: "2026-02-29" }, "invalid_date"],
    [{ startTime: "25:00" }, "invalid_time"], [{ timeZone: "UTC" }, "zone_conflict"]
  ] as const)("preserves actual ambiguity %j", (changes, reason) => {
    expect(evaluate({ candidate: { ...candidate, ...changes } })).toMatchObject({ eligibility: "unknown", reason });
  });
  it.each([["2026-03-29", "nonexistent_local_time"], ["2026-10-25", "ambiguous_local_time"]])("does not choose a DST instant for %s", (date, reason) => {
    expect(evaluate({ candidate: { ...candidate, date, startTime: "02:30" }, authorization: { ...authorization,
      windows: [{ date, startTime: "00:00", endTime: "23:59" }] } })).toMatchObject({ eligibility: "unknown", reason });
  });
  it.each(["2028-02-29", "2026-12-31", "2027-01-01"])("handles calendar boundary %s", date => {
    expect(evaluate({ candidate: { ...candidate, date }, authorization: { ...authorization,
      windows: [{ date, startTime: "09:00", endTime: "18:00" }] } }).eligibility).toBe("within");
  });
  it.each(["Pacific/Kiritimati", "Pacific/Honolulu", "Asia/Kathmandu"])("uses the approved IANA zone %s", timeZone => {
    expect(evaluate({ candidate: { ...candidate, timeZone }, authorization: { ...authorization, timeZone } }).eligibility).toBe("within");
  });
  it("does not infer permission or a reference clock", () => {
    expect(evaluate({ authorization: null })).toMatchObject({ eligibility: "unknown", reason: "missing_authority" });
    expect(evaluate({ authorization: null, applicable: false }).eligibility).toBe("not_applicable");
    expect(evaluate({ referenceAt: null })).toMatchObject({ eligibility: "within", pastAtReference: null });
    expect(evaluate({ referenceAt: "2026-11-01T00:00:00Z" })).toMatchObject({ eligibility: "within", pastAtReference: true });
  });
});
