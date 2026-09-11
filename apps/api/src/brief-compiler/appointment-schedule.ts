import {
  appointmentDateSchema,
  appointmentTimeSchema,
  appointmentTimeZoneSchema,
  type AppointmentAuthorization
} from "@callassist/contracts";

export type AppointmentDateSelector =
  | { kind: "dates"; dates: string[] }
  | { kind: "range"; startDate: string; endDate: string }
  | { kind: "relative_days"; startOffsetDays: number; count: number }
  | { kind: "next_calendar_week" };

export interface AppointmentScheduleGroup {
  dates: AppointmentDateSelector;
  /** ISO Monday=1 .. Sunday=7. Empty means every weekday before exclusions. */
  weekdays: number[];
  excludedWeekdays: number[];
  excludedDates: string[];
  startTime: string;
  endTime: string;
}

/** Compiler-only declaration. It grants no authority and is not an execution DTO. */
export interface AppointmentSchedule {
  timeZone: string;
  groups: AppointmentScheduleGroup[];
}

export type AppointmentScheduleFailureReason =
  | "invalid_schedule"
  | "invalid_clock"
  | "invalid_time_zone"
  | "invalid_date"
  | "invalid_time_range"
  | "candidate_limit_exceeded"
  | "window_limit_exceeded"
  | "empty_schedule"
  | "past_window";

export type AppointmentScheduleResult =
  | {
    ok: true;
    windows: AppointmentAuthorization["windows"];
    /**
     * Finite union of the selected date domains BEFORE weekday/date exclusions.
     * Includes excluded dates only when they belong to a selected domain; never
     * imports arbitrary excludedDates as evidence. These dates may explain the
     * calendar, but only windows carry possible start times. The caller still
     * checks source meaning, operation, user approval and execution permission.
     */
    calendarDates: string[];
  }
  | { ok: false; reason: AppointmentScheduleFailureReason };

const MAX_CANDIDATES = 366;
const MAX_WINDOWS = 31;
const DAY_MS = 86_400_000;
const dateJson = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;
const timeJson = { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" } as const;
const weekdaysJson = { type: "array", maxItems: 7, items: { type: "integer", enum: [1, 2, 3, 4, 5, 6, 7] } } as const;

/** All properties are required and all objects closed, for strict model output. */
export const MODEL_APPOINTMENT_SCHEDULE_JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["timeZone", "groups"],
  properties: {
    timeZone: { type: "string", minLength: 1, maxLength: 80 },
    groups: {
      type: "array", minItems: 1, maxItems: 31,
      items: {
        type: "object", additionalProperties: false,
        required: ["dates", "weekdays", "excludedWeekdays", "excludedDates", "startTime", "endTime"],
        properties: {
          dates: { anyOf: [
            { type: "object", additionalProperties: false, required: ["kind", "dates"],
              properties: { kind: { type: "string", enum: ["dates"] }, dates: { type: "array", minItems: 1, maxItems: 366, items: dateJson } } },
            { type: "object", additionalProperties: false, required: ["kind", "startDate", "endDate"],
              properties: { kind: { type: "string", enum: ["range"] }, startDate: dateJson, endDate: dateJson } },
            { type: "object", additionalProperties: false, required: ["kind", "startOffsetDays", "count"],
              properties: { kind: { type: "string", enum: ["relative_days"] }, startOffsetDays: { type: "integer", minimum: 0, maximum: 365 }, count: { type: "integer", minimum: 1, maximum: 366 } } },
            { type: "object", additionalProperties: false, required: ["kind"],
              properties: { kind: { type: "string", enum: ["next_calendar_week"] } } }
          ] },
          weekdays: weekdaysJson,
          excludedWeekdays: weekdaysJson,
          excludedDates: { type: "array", maxItems: 366, items: dateJson },
          startTime: timeJson,
          endTime: timeJson
        }
      }
    }
  }
} as const;

/**
 * Resolve declarations against a trusted clock. No LLM/provider, host-local date
 * arithmetic, truncation at a cap or silent removal of wholly past windows.
 * A partially past window today keeps its original lower bound: the realtime
 * slot validator rejects past/nonexistent/ambiguous proposed instants later.
 */
export function resolveAppointmentSchedule(raw: unknown, now: Date): AppointmentScheduleResult {
  try {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return failure("invalid_clock");
    if (!hasKeys(raw, ["timeZone", "groups"])) return failure("invalid_schedule");
    const zone = appointmentTimeZoneSchema.safeParse(raw.timeZone);
    if (!zone.success || zone.data !== raw.timeZone) return failure("invalid_time_zone");
    if (!Array.isArray(raw.groups) || raw.groups.length < 1 || raw.groups.length > MAX_WINDOWS) return failure("invalid_schedule");
    const local = localClock(now, zone.data);
    if (!local) return failure("invalid_clock");
    const calendarDates = new Set<string>();
    const windows = new Map<string, AppointmentAuthorization["windows"][number]>();
    let expandedCandidates = 0;

    for (const rawGroup of raw.groups) {
      if (!hasKeys(rawGroup, ["dates", "weekdays", "excludedWeekdays", "excludedDates", "startTime", "endTime"])) return failure("invalid_schedule");
      if (!isWeekdays(rawGroup.weekdays) || !isWeekdays(rawGroup.excludedWeekdays)) return failure("invalid_schedule");
      if (!Array.isArray(rawGroup.excludedDates) || rawGroup.excludedDates.length > MAX_CANDIDATES) return failure("invalid_schedule");
      if (!rawGroup.excludedDates.every(isDate)) return failure("invalid_date");
      const start = appointmentTimeSchema.safeParse(rawGroup.startTime);
      const end = appointmentTimeSchema.safeParse(rawGroup.endTime);
      if (!start.success || !end.success || start.data > end.data) return failure("invalid_time_range");
      const expanded = expandDates(rawGroup.dates, local.date);
      if (!expanded.ok) return expanded;
      expandedCandidates += expanded.dates.length;
      if (expandedCandidates > MAX_CANDIDATES) return failure("candidate_limit_exceeded");
      for (const date of expanded.dates) {
        calendarDates.add(date);
        const weekday = isoWeekday(date);
        if ((rawGroup.weekdays.length && !rawGroup.weekdays.includes(weekday)) ||
          rawGroup.excludedWeekdays.includes(weekday) || rawGroup.excludedDates.includes(date)) continue;
        if (date < local.date || (date === local.date && minuteOfDay(end.data) * 60_000 <= local.milliseconds)) {
          return failure("past_window");
        }
        const window = { date, startTime: start.data, endTime: end.data };
        windows.set(`${date}|${start.data}|${end.data}`, window);
        if (windows.size > MAX_WINDOWS) return failure("window_limit_exceeded");
      }
    }
    if (!windows.size) return failure("empty_schedule");
    return {
      ok: true,
      windows: [...windows.values()].sort((a, b) => a.date.localeCompare(b.date) ||
        a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime)),
      calendarDates: [...calendarDates].sort()
    };
  } catch {
    return failure("invalid_schedule");
  }
}

function failure(reason: AppointmentScheduleFailureReason): { ok: false; reason: AppointmentScheduleFailureReason } {
  return { ok: false, reason };
}

function hasKeys(raw: unknown, keys: string[]): raw is Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const prototype = Object.getPrototypeOf(raw);
  return (prototype === Object.prototype || prototype === null) &&
    Object.keys(raw).length === keys.length && keys.every(key => Object.hasOwn(raw, key));
}

function isDate(value: unknown): value is string {
  return appointmentDateSchema.safeParse(value).success;
}

function isWeekdays(value: unknown): value is number[] {
  return Array.isArray(value) && value.length <= 7 &&
    value.every(day => Number.isInteger(day) && day >= 1 && day <= 7);
}

function minuteOfDay(time: string) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

// UTC midnight is only a Gregorian date ordinal here, never the appointment's
// instant. Resolve the clock's local date first, then add calendar days to it.
function dateOrdinal(date: string) { return Date.parse(`${date}T00:00:00.000Z`); }
function addDays(date: string, days: number): string | null {
  const instant = new Date(dateOrdinal(date) + days * DAY_MS);
  if (!Number.isFinite(instant.getTime())) return null;
  const value = instant.toISOString().slice(0, 10);
  return isDate(value) ? value : null;
}
function isoWeekday(date: string) { return new Date(dateOrdinal(date)).getUTCDay() || 7; }

function localClock(now: Date, timeZone: string): { date: string; milliseconds: number } | null {
  const parts = new Intl.DateTimeFormat("en-GB-u-ca-iso8601-nu-latn", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
  const date = `${part("year")?.padStart(4, "0")}-${part("month")}-${part("day")}`;
  const milliseconds = (Number(part("hour")) * 3_600 + Number(part("minute")) * 60 + Number(part("second"))) * 1_000 + now.getUTCMilliseconds();
  return isDate(date) && Number.isFinite(milliseconds) ? { date, milliseconds } : null;
}

function expandDates(raw: unknown, today: string): { ok: true; dates: string[] } | { ok: false; reason: AppointmentScheduleFailureReason } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return failure("invalid_schedule");
  const selector = raw as Record<string, unknown>;
  let first: string | null;
  let count: number;
  switch (selector.kind) {
    case "dates":
      if (!hasKeys(raw, ["kind", "dates"]) || !Array.isArray(selector.dates) || selector.dates.length < 1) return failure("invalid_schedule");
      if (selector.dates.length > MAX_CANDIDATES) return failure("candidate_limit_exceeded");
      if (!selector.dates.every(isDate)) return failure("invalid_date");
      return { ok: true, dates: [...selector.dates] };
    case "range":
      if (!hasKeys(raw, ["kind", "startDate", "endDate"])) return failure("invalid_schedule");
      if (!isDate(selector.startDate) || !isDate(selector.endDate) || selector.startDate > selector.endDate) return failure("invalid_date");
      first = selector.startDate;
      count = (dateOrdinal(selector.endDate) - dateOrdinal(first)) / DAY_MS + 1;
      break;
    case "relative_days":
      if (!hasKeys(raw, ["kind", "startOffsetDays", "count"]) ||
        typeof selector.startOffsetDays !== "number" || !Number.isInteger(selector.startOffsetDays) ||
        selector.startOffsetDays < 0 || selector.startOffsetDays > 365 ||
        typeof selector.count !== "number" || !Number.isInteger(selector.count) || selector.count < 1) return failure("invalid_schedule");
      first = addDays(today, selector.startOffsetDays);
      count = selector.count;
      break;
    case "next_calendar_week":
      if (!hasKeys(raw, ["kind"])) return failure("invalid_schedule");
      first = addDays(today, 8 - isoWeekday(today));
      count = 7;
      break;
    default:
      return failure("invalid_schedule");
  }
  if (count > MAX_CANDIDATES) return failure("candidate_limit_exceeded");
  if (!first) return failure("invalid_date");
  const dates: string[] = [];
  for (let index = 0; index < count; index++) {
    const date = addDays(first, index);
    if (!date) return failure("invalid_date");
    dates.push(date);
  }
  return { ok: true, dates };
}
