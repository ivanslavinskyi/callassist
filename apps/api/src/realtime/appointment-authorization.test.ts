import type { AppointmentAuthorization } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_AUTHORIZATION_TOOL,
  parseAppointmentProposal,
  validateAppointmentProposal,
  type AppointmentProposal
} from "./appointment-authorization";

const authorization: AppointmentAuthorization = {
  operation: "book",
  serviceDescription: "Routine consultation",
  providerScope: "called_recipient",
  timeZone: "Europe/Zurich",
  windows: [{ date: "2026-09-17", startTime: "09:00", endTime: "11:00" }],
  selection: "first_matching",
  maxAppointments: 1,
  financialPolicy: "no_new_financial_terms"
};
const proposal: AppointmentProposal = {
  operation: "book", date: "2026-09-17", startTime: "09:30", timeZone: "Europe/Zurich",
  serviceMatches: true, recipientMatches: true,
  requiresPaymentOrNewTerms: false, detailsConfirmed: true
};
const now = new Date("2026-01-01T00:00:00.000Z");
function check(changes: Partial<AppointmentProposal> = {}, permission: AppointmentAuthorization | null | undefined = authorization) {
  return validateAppointmentProposal({ authorization: permission, proposal: { ...proposal, ...changes }, now });
}

describe("appointment proposal parsing", () => {
  it("accepts JSON tool arguments and a plain object without changing either", () => {
    const encoded = JSON.stringify(proposal);
    expect(parseAppointmentProposal(encoded)).toEqual({ ok: true, proposal });
    const input = Object.freeze({ ...proposal });
    expect(parseAppointmentProposal(input)).toEqual({ ok: true, proposal });
  });

  it.each([
    null, undefined, true, 1, [], new Date(), "null", "[]", "{", " ".repeat(2_049),
    { ...proposal, additionalPermission: true },
    { ...proposal, detailsConfirmed: "true" },
    { ...proposal, serviceMatches: 1 },
    { ...proposal, recipientMatches: null },
    { ...proposal, requiresPaymentOrNewTerms: "false" },
    { ...proposal, operation: "cancel" },
    { ...proposal, date: "2026-02-29" },
    { ...proposal, date: "2026-04-31" },
    { ...proposal, date: "2026-9-17" },
    { ...proposal, date: "2026-09-17T00:00:00Z" },
    { ...proposal, startTime: "24:00" },
    { ...proposal, startTime: "09:60" },
    { ...proposal, startTime: "9:30" },
    { ...proposal, startTime: "09:30:00" },
    { ...proposal, timeZone: "" },
    { ...proposal, timeZone: "a".repeat(101) }
  ])("rejects malformed, coerced or additional arguments %#", raw => {
    expect(parseAppointmentProposal(raw)).toEqual({ ok: false, reason: "invalid_arguments" });
  });

  it.each(Object.keys(proposal))("requires the explicit %s field", field => {
    const missing: Record<string, unknown> = { ...proposal };
    delete missing[field];
    expect(parseAppointmentProposal(missing)).toEqual({ ok: false, reason: "invalid_arguments" });
  });

  it("exposes exactly the server's required arguments in the tool schema", () => {
    expect(APPOINTMENT_AUTHORIZATION_TOOL.name).toBe("check_appointment");
    expect(APPOINTMENT_AUTHORIZATION_TOOL.parameters.additionalProperties).toBe(false);
    expect([...APPOINTMENT_AUTHORIZATION_TOOL.parameters.required].sort()).toEqual(Object.keys(proposal).sort());
    expect(Object.keys(APPOINTMENT_AUTHORIZATION_TOOL.parameters.properties).sort()).toEqual(Object.keys(proposal).sort());
  });
});

describe("appointment authorization", () => {
  it.each(["09:00", "09:30", "11:00"])("allows the inclusive start-time window at %s", startTime => {
    const result = check({ startTime });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.startsAt).toBe(`2026-09-17T${String(Number(startTime.slice(0, 2)) - 2).padStart(2, "0")}:${startTime.slice(3)}:00.000Z`);
      expect(result.proposal.startTime).toBe(startTime);
    }
  });

  it.each(["08:59", "11:01"])("rejects the minute outside the approved window: %s", startTime => {
    expect(check({ startTime })).toEqual({ ok: false, reason: "outside_authorized_window" });
  });

  it("requires the exact time when both window bounds are equal", () => {
    const permission = { ...authorization, windows: [{ date: proposal.date, startTime: "09:30", endTime: "09:30" }] };
    expect(check({}, permission).ok).toBe(true);
    expect(check({ startTime: "09:29" }, permission)).toEqual({ ok: false, reason: "outside_authorized_window" });
    expect(check({ startTime: "09:31" }, permission)).toEqual({ ok: false, reason: "outside_authorized_window" });
  });

  it("does not turn separate windows into one broad interval", () => {
    const permission = { ...authorization, windows: [
      { date: proposal.date, startTime: "09:00", endTime: "09:15" },
      { date: proposal.date, startTime: "10:00", endTime: "10:15" }
    ] };
    expect(check({}, permission)).toEqual({ ok: false, reason: "outside_authorized_window" });
    expect(check({ startTime: "10:15" }, permission).ok).toBe(true);
  });

  it("does not allow a matching time on an unapproved date", () => {
    expect(check({ date: "2026-09-18" })).toEqual({ ok: false, reason: "outside_authorized_window" });
  });

  it.each([null, undefined])("does not infer permission for a legacy or missing authorization", permission => {
    expect(validateAppointmentProposal({ authorization: permission, proposal, now })).toEqual({ ok: false, reason: "missing_authorization" });
  });

  it.each([
    { ...authorization, maxAppointments: 2 },
    { ...authorization, providerScope: "any_recipient" },
    { ...authorization, financialPolicy: "allow_deposit" },
    { ...authorization, timeZone: "Invalid/Zone" },
    { ...authorization, windows: [] },
    { ...authorization, windows: [{ date: proposal.date, startTime: "11:00", endTime: "09:00" }] },
    { ...authorization, operation: "confirm_existing" },
    { ...authorization, operation: "confirm_existing", windows: [
      { date: proposal.date, startTime: "09:30", endTime: "09:30" },
      { date: "2026-09-18", startTime: "09:30", endTime: "09:30" }
    ] },
    { ...authorization, serviceDescription: "" },
    { ...authorization, extraPermission: true }
  ])("rejects malformed stored authorization %#", permission => {
    expect(check({}, permission as AppointmentAuthorization)).toEqual({ ok: false, reason: "invalid_authorization" });
  });

  it.each([
    [{ detailsConfirmed: false }, "unconfirmed_details"],
    [{ serviceMatches: false }, "service_mismatch"],
    [{ recipientMatches: false }, "recipient_mismatch"],
    [{ requiresPaymentOrNewTerms: true }, "financial_terms_not_allowed"],
    [{ operation: "confirm_existing" }, "operation_mismatch"],
    [{ timeZone: "Europe/Berlin" }, "time_zone_mismatch"],
    [{ timeZone: "+02:00" }, "time_zone_mismatch"],
    [{ timeZone: "Europe/Zurich " }, "time_zone_mismatch"]
  ] as const)("does not widen approved scope: %j", (changes, reason) => {
    expect(check(changes)).toEqual({ ok: false, reason });
  });

  it("confirms an existing appointment only with that specific operation approved", () => {
    const permission: AppointmentAuthorization = { ...authorization, operation: "confirm_existing",
      windows: [{ date: proposal.date, startTime: proposal.startTime, endTime: proposal.startTime }] };
    expect(check({ operation: "confirm_existing" }, permission).ok).toBe(true);
    expect(check({}, permission)).toEqual({ ok: false, reason: "operation_mismatch" });
  });

  it.each(["2026-09-17T07:30:00.000Z", "2026-09-17T07:30:00.001Z", "2026-09-18T00:00:00.000Z"])("requires the slot to be strictly in the future relative to %s", currentTime => {
    expect(validateAppointmentProposal({ authorization, proposal, now: new Date(currentTime) }))
      .toEqual({ ok: false, reason: "past_time" });
  });

  it("uses the supplied clock, including milliseconds", () => {
    expect(validateAppointmentProposal({ authorization, proposal, now: new Date("2026-09-17T07:29:59.999Z") }).ok).toBe(true);
    expect(validateAppointmentProposal({ authorization, proposal, now: new Date("invalid") }))
      .toEqual({ ok: false, reason: "invalid_clock" });
  });
});

describe("local appointment time resolution", () => {
  function forSlot(date: string, startTime: string, timeZone: string, currentTime = now) {
    return validateAppointmentProposal({
      authorization: { ...authorization, timeZone, windows: [{ date, startTime, endTime: startTime }] },
      proposal: { ...proposal, date, startTime, timeZone }, now: currentTime
    });
  }

  it.each([
    ["2026-03-29", "02:30", "Europe/Zurich"],
    ["2026-10-04", "02:15", "Australia/Lord_Howe"]
  ])("rejects a nonexistent wall-clock time %s %s in %s", (date, startTime, timeZone) => {
    expect(forSlot(date, startTime, timeZone)).toEqual({ ok: false, reason: "nonexistent_local_time" });
  });

  it.each([
    ["2026-10-25", "02:30", "Europe/Zurich"],
    ["2026-04-05", "01:45", "Australia/Lord_Howe"]
  ])("rejects both one-hour and half-hour ambiguous folds: %s %s in %s", (date, startTime, timeZone) => {
    expect(forSlot(date, startTime, timeZone)).toEqual({ ok: false, reason: "ambiguous_local_time" });
  });

  it("does not resolve ambiguity by silently discarding the earlier past occurrence", () => {
    expect(forSlot("2026-10-25", "02:30", "Europe/Zurich", new Date("2026-10-25T01:00:00.000Z")))
      .toEqual({ ok: false, reason: "ambiguous_local_time" });
  });

  it.each([
    ["2026-03-29", "01:59", "Europe/Zurich", "2026-03-29T00:59:00.000Z"],
    ["2026-03-29", "03:00", "Europe/Zurich", "2026-03-29T01:00:00.000Z"],
    ["2026-10-25", "03:00", "Europe/Zurich", "2026-10-25T02:00:00.000Z"],
    ["2026-09-17", "09:30", "Asia/Kathmandu", "2026-09-17T03:45:00.000Z"],
    ["2026-09-17", "00:00", "Pacific/Kiritimati", "2026-09-16T10:00:00.000Z"],
    ["2026-01-02", "23:59", "America/St_Johns", "2026-01-03T03:29:00.000Z"],
    ["2028-02-29", "00:00", "UTC", "2028-02-29T00:00:00.000Z"]
  ])("resolves the exact instant for %s %s in %s", (date, startTime, timeZone, startsAt) => {
    expect(forSlot(date, startTime, timeZone)).toEqual({
      ok: true, proposal: { ...proposal, date, startTime, timeZone }, startsAt
    });
  });

  it("rejects a whole skipped calendar day instead of rolling it forward", () => {
    expect(forSlot("2011-12-30", "12:00", "Pacific/Apia", new Date("2011-01-01T00:00:00.000Z")))
      .toEqual({ ok: false, reason: "nonexistent_local_time" });
  });
});
