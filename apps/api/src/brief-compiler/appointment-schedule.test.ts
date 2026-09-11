import { appointmentAuthorizationSchema } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import {
  MODEL_APPOINTMENT_SCHEDULE_JSON_SCHEMA,
  resolveAppointmentSchedule,
  type AppointmentSchedule,
  type AppointmentScheduleGroup
} from "./appointment-schedule";

const now = new Date("2026-09-10T08:30:00.000Z"); // Thursday 10:30 in Zurich.
const group: AppointmentScheduleGroup = {
  dates: { kind: "next_calendar_week" }, weekdays: [], excludedWeekdays: [],
  excludedDates: [], startTime: "09:00", endTime: "12:00"
};
function schedule(changes: Partial<AppointmentScheduleGroup> = {}): AppointmentSchedule {
  return { timeZone: "Europe/Zurich", groups: [{ ...group, ...changes }] };
}
function dates(result: ReturnType<typeof resolveAppointmentSchedule>) {
  if (!result.ok) throw new Error(result.reason);
  return result.windows.map(window => window.date);
}

describe("declarative appointment calendars", () => {
  it("expands the next calendar week and applies weekday and date exclusions", () => {
    const result = resolveAppointmentSchedule(schedule({
      weekdays: [1, 2, 3, 4, 5], excludedWeekdays: [5], excludedDates: ["2026-09-15", "2026-10-01"]
    }), now);
    expect(result).toEqual({
      ok: true,
      windows: ["2026-09-14", "2026-09-16", "2026-09-17"].map(date => ({ date, startTime: "09:00", endTime: "12:00" })),
      calendarDates: ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"]
    });
  });

  it("uses ISO weekdays, with exclusions taking priority over inclusions", () => {
    expect(dates(resolveAppointmentSchedule(schedule({ weekdays: [1, 7], excludedWeekdays: [1] }), now)))
      .toEqual(["2026-09-20"]);
    expect(dates(resolveAppointmentSchedule(schedule({ excludedWeekdays: [1, 2, 3, 4, 5, 6] }), now)))
      .toEqual(["2026-09-20"]);
  });

  it("uses both inclusive dates of a concrete range", () => {
    expect(dates(resolveAppointmentSchedule(schedule({ dates: { kind: "range", startDate: "2026-09-11", endDate: "2026-09-13" } }), now)))
      .toEqual(["2026-09-11", "2026-09-12", "2026-09-13"]);
  });

  it("sorts and deduplicates explicit dates without filling the gaps", () => {
    const declaration = schedule({ dates: { kind: "dates", dates: ["2026-09-18", "2026-09-11", "2026-09-18"] } });
    const before = structuredClone(declaration);
    const result = resolveAppointmentSchedule(declaration, now);
    expect(dates(result)).toEqual(["2026-09-11", "2026-09-18"]);
    expect(result.ok && result.calendarDates).toEqual(["2026-09-11", "2026-09-18"]);
    expect(declaration).toEqual(before);
  });

  it("keeps disjoint time ranges and date-specific groups separate", () => {
    const morning = { ...group, dates: { kind: "dates", dates: ["2026-09-14"] } as const, startTime: "09:00", endTime: "10:00" };
    const result = resolveAppointmentSchedule({ timeZone: "Europe/Zurich", groups: [
      { ...morning, dates: { kind: "dates", dates: ["2026-09-15"] } },
      { ...morning, startTime: "14:00", endTime: "16:00" }, morning, morning
    ] }, now);
    expect(result).toEqual({ ok: true, windows: [
      { date: "2026-09-14", startTime: "09:00", endTime: "10:00" },
      { date: "2026-09-14", startTime: "14:00", endTime: "16:00" },
      { date: "2026-09-15", startTime: "09:00", endTime: "10:00" }
    ], calendarDates: ["2026-09-14", "2026-09-15"] });
  });

  it("does not add a date excluded outside its group's selected domain", () => {
    const result = resolveAppointmentSchedule(schedule({
      dates: { kind: "dates", dates: ["2026-09-14"] }, excludedDates: ["2026-09-15", "2027-01-01"]
    }), now);
    expect(result.ok && result.calendarDates).toEqual(["2026-09-14"]);
    expect(dates(result)).toEqual(["2026-09-14"]);
  });

  it("allows an empty filtered group when another selected group still has windows", () => {
    const result = resolveAppointmentSchedule({ timeZone: "Europe/Zurich", groups: [
      { ...group, weekdays: [1], excludedWeekdays: [1] },
      { ...group, dates: { kind: "dates", dates: ["2026-09-21"] } }
    ] }, now);
    expect(dates(result)).toEqual(["2026-09-21"]);
    expect(result.ok && result.calendarDates).toContain("2026-09-14");
  });
});

describe("relative dates use the trusted local calendar", () => {
  it.each([
    [0, ["2026-09-10", "2026-09-11"]],
    [1, ["2026-09-11", "2026-09-12"]],
    [2, ["2026-09-12", "2026-09-13"]]
  ] as const)("supports explicit offset %i without inventing a starting day", (startOffsetDays, expected) => {
    expect(dates(resolveAppointmentSchedule(schedule({ dates: { kind: "relative_days", startOffsetDays, count: 2 } }), now)))
      .toEqual(expected);
  });

  it.each([
    ["2026-09-13T21:30:00.000Z", "Europe/Zurich", "2026-09-14", "2026-09-20"],
    ["2026-09-13T22:30:00.000Z", "Europe/Zurich", "2026-09-21", "2026-09-27"],
    ["2026-09-13T22:30:00.000Z", "UTC", "2026-09-14", "2026-09-20"],
    ["2026-12-31T12:00:00.000Z", "Europe/Zurich", "2027-01-04", "2027-01-10"]
  ])("next week follows the local Monday boundary for %s in %s", (timestamp, timeZone, first, last) => {
    const result = dates(resolveAppointmentSchedule({ ...schedule(), timeZone }, new Date(timestamp)));
    expect(result).toHaveLength(7);
    expect([result[0], result.at(-1)]).toEqual([first, last]);
  });

  it.each([
    ["2026-03-28T23:30:00.000Z", ["2026-03-30", "2026-03-31"]],
    ["2026-10-24T22:30:00.000Z", ["2026-10-26", "2026-10-27"]],
    ["2028-02-28T22:30:00.000Z", ["2028-02-29", "2028-03-01"]],
    ["2026-12-31T12:00:00.000Z", ["2027-01-01", "2027-01-02"]]
  ] as const)("does calendar arithmetic across DST/leap/year boundaries at %s", (timestamp, expected) => {
    expect(dates(resolveAppointmentSchedule(schedule({ dates: { kind: "relative_days", startOffsetDays: 1, count: 2 } }), new Date(timestamp))))
      .toEqual(expected);
  });

  it.each([["Pacific/Kiritimati", "2026-09-11"], ["Pacific/Honolulu", "2026-09-10"]])("today is resolved in %s", (timeZone, expected) => {
    const declaration = { ...schedule({ dates: { kind: "relative_days", startOffsetDays: 0, count: 1 } }), timeZone };
    expect(dates(resolveAppointmentSchedule(declaration, new Date("2026-09-10T12:30:00.000Z")))).toEqual([expected]);
  });

  it.each([
    ["2026-03-29T00:30:00.000Z", "2026-03-29", "01:00", "02:30"],
    ["2026-10-25T00:10:00.000Z", "2026-10-25", "01:30", "03:30"]
  ])("keeps a useful window at %s; the realtime validator resolves the actual DST slot", (timestamp, date, startTime, endTime) => {
    const result = resolveAppointmentSchedule(schedule({ dates: { kind: "dates", dates: [date] }, startTime, endTime }), new Date(timestamp));
    expect(result.ok && result.windows).toEqual([{ date, startTime, endTime }]);
  });
});

describe("past times and capacity fail without silently narrowing the request", () => {
  it("preserves today's past lower bound when the upper bound is still future", () => {
    const result = resolveAppointmentSchedule(schedule({ dates: { kind: "dates", dates: ["2026-09-10"] } }), now);
    expect(result.ok && result.windows).toEqual([{ date: "2026-09-10", startTime: "09:00", endTime: "12:00" }]);
  });

  it.each([
    schedule({ dates: { kind: "dates", dates: ["2026-09-09"] } }),
    schedule({ dates: { kind: "dates", dates: ["2026-09-09", "2026-09-11"] } }),
    schedule({ dates: { kind: "dates", dates: ["2026-09-10"] }, startTime: "09:00", endTime: "10:29" }),
    schedule({ dates: { kind: "dates", dates: ["2026-09-10"] }, startTime: "10:30", endTime: "10:30" })
  ])("rejects a wholly past selected window %#", declaration => {
    expect(resolveAppointmentSchedule(declaration, now)).toEqual({ ok: false, reason: "past_window" });
  });

  it("evaluates past dates after explicit exclusions, without deleting them from the calendar domain", () => {
    const result = resolveAppointmentSchedule(schedule({ dates: { kind: "range", startDate: "2026-09-09", endDate: "2026-09-11" }, excludedDates: ["2026-09-09"] }), now);
    expect(dates(result)).toEqual(["2026-09-10", "2026-09-11"]);
    expect(result.ok && result.calendarDates).toContain("2026-09-09");
  });

  it("allows exactly 31 windows and rejects 32 without returning the first 31", () => {
    expect(dates(resolveAppointmentSchedule(schedule({ dates: { kind: "range", startDate: "2026-09-11", endDate: "2026-10-11" } }), now))).toHaveLength(31);
    expect(resolveAppointmentSchedule(schedule({ dates: { kind: "range", startDate: "2026-09-11", endDate: "2026-10-12" } }), now))
      .toEqual({ ok: false, reason: "window_limit_exceeded" });
  });

  it("bounds candidate expansion before exclusions, including a leap year", () => {
    const excludedWeekdays = [1, 2, 3, 4, 5, 6, 7];
    expect(resolveAppointmentSchedule(schedule({ dates: { kind: "range", startDate: "2028-01-01", endDate: "2028-12-31" }, excludedWeekdays }), now))
      .toEqual({ ok: false, reason: "empty_schedule" });
    expect(resolveAppointmentSchedule(schedule({ dates: { kind: "range", startDate: "2028-01-01", endDate: "2029-01-01" }, excludedWeekdays }), now))
      .toEqual({ ok: false, reason: "candidate_limit_exceeded" });
  });

  it("applies the candidate budget across groups even for duplicated dates", () => {
    const repeated = { ...group, dates: { kind: "dates", dates: Array(183).fill("2026-09-11") } };
    expect(dates(resolveAppointmentSchedule({ timeZone: "Europe/Zurich", groups: [repeated, repeated] }, now))).toEqual(["2026-09-11"]);
    expect(resolveAppointmentSchedule({ timeZone: "Europe/Zurich", groups: [repeated, repeated, { ...group, dates: { kind: "dates", dates: ["2026-09-12"] } }] }, now))
      .toEqual({ ok: false, reason: "candidate_limit_exceeded" });
  });

  it("leaves confirm_existing's one exact slot requirement in the authorization contract", () => {
    const result = resolveAppointmentSchedule(schedule({ dates: { kind: "dates", dates: ["2026-09-11"] }, startTime: "14:00", endTime: "14:00" }), now);
    if (!result.ok) throw new Error(result.reason);
    const authorization = { operation: "confirm_existing", serviceDescription: "Existing meeting", providerScope: "called_recipient", timeZone: "Europe/Zurich",
      windows: result.windows, selection: "first_matching", maxAppointments: 1, financialPolicy: "no_new_financial_terms" };
    expect(appointmentAuthorizationSchema.safeParse(authorization).success).toBe(true);
    expect(appointmentAuthorizationSchema.safeParse({ ...authorization, windows: [...result.windows, ...result.windows] }).success).toBe(false);
    expect(appointmentAuthorizationSchema.safeParse({ ...authorization, windows: [{ ...result.windows[0], endTime: "15:00" }] }).success).toBe(false);
  });
});

describe("schedule declarations are strict and bounded", () => {
  it.each([
    null, [], "{}", { ...schedule(), unknown: true }, { ...schedule(), groups: [] },
    { ...schedule(), groups: Array(32).fill(group) },
    schedule({ weekdays: [0] }), schedule({ weekdays: [8] }), schedule({ weekdays: [1.5] }),
    schedule({ weekdays: ["1"] as unknown as number[] }), schedule({ excludedWeekdays: [8] }),
    schedule({ dates: { kind: "range", startDate: "2026-09-11", endDate: "2026-09-12", other: true } } as never),
    schedule({ dates: { kind: "relative_days", count: 2 } } as never),
    schedule({ dates: { kind: "relative_days", startOffsetDays: -1, count: 2 } }),
    schedule({ dates: { kind: "relative_days", startOffsetDays: 366, count: 2 } }),
    schedule({ dates: { kind: "relative_days", startOffsetDays: 0, count: 0 } }),
    schedule({ dates: { kind: "relative_days", startOffsetDays: 0, count: 1.5 } }),
    schedule({ dates: { kind: "dates", dates: [] } })
  ])("rejects invalid shapes and values %#", declaration => {
    expect(resolveAppointmentSchedule(declaration, now)).toEqual({ ok: false, reason: "invalid_schedule" });
  });

  it.each(["Invalid/Zone", "+01:00", " Europe/Zurich "])("rejects the invalid IANA zone %s", timeZone => {
    expect(resolveAppointmentSchedule({ ...schedule(), timeZone }, now)).toEqual({ ok: false, reason: "invalid_time_zone" });
  });

  it.each([
    schedule({ dates: { kind: "dates", dates: ["2026-02-29"] } }),
    schedule({ dates: { kind: "range", startDate: "2026-09-12", endDate: "2026-09-11" } }),
    schedule({ dates: { kind: "dates", dates: ["2026-09-11T09:00Z"] } }),
    schedule({ excludedDates: ["2026-04-31"] })
  ])("rejects invalid dates rather than normalizing or rolling them %#", declaration => {
    expect(resolveAppointmentSchedule(declaration, now)).toEqual({ ok: false, reason: "invalid_date" });
  });

  it.each([["24:00", "24:00"], ["09:60", "10:00"], ["9:00", "10:00"], ["23:00", "01:00"]])("rejects invalid or implicit overnight ranges %s-%s", (startTime, endTime) => {
    expect(resolveAppointmentSchedule(schedule({ startTime, endTime }), now)).toEqual({ ok: false, reason: "invalid_time_range" });
  });

  it("requires a valid caller-supplied clock", () => {
    expect(resolveAppointmentSchedule(schedule(), new Date("invalid"))).toEqual({ ok: false, reason: "invalid_clock" });
  });

  it("does not produce a partial plan when exclusions remove every candidate", () => {
    expect(resolveAppointmentSchedule(schedule({ dates: { kind: "dates", dates: ["2026-09-11"] }, excludedDates: ["2026-09-11"] }), now))
      .toEqual({ ok: false, reason: "empty_schedule" });
  });

  it("keeps every model object closed and every field required, including selector variants", () => {
    function inspect(value: unknown) {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(inspect); return; }
      const record = value as Record<string, unknown>;
      if (record.type === "object") {
        expect(record.additionalProperties).toBe(false);
        expect([...(record.required as string[])].sort()).toEqual(Object.keys(record.properties as object).sort());
      }
      Object.values(record).forEach(inspect);
    }
    inspect(MODEL_APPOINTMENT_SCHEDULE_JSON_SCHEMA);
  });
});
