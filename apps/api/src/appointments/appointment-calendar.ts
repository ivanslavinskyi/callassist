import { appointmentAuthorizationSchema, appointmentDateSchema, appointmentTimeSchema, type AppointmentAuthorization } from "@callassist/contracts";

export const APPOINTMENT_CALENDAR_VERSION = "appointment-calendar-v1";
export type CalendarCandidate = { date: string | null; startTime: string | null; timeZone: string | null };
export type CalendarReason = "exact_window" | "outside_window" | "missing_date" | "missing_time" | "zone_conflict" |
  "invalid_date" | "invalid_time" | "nonexistent_local_time" | "ambiguous_local_time" | "missing_authority" | "invalid_authority" | "conflicting_candidates";
export type CalendarEvaluation = {
  eligibility: "within" | "outside" | "unknown" | "not_applicable";
  reason: CalendarReason;
  windowIndex: number | null;
  startsAt: string | null;
  pastAtReference: boolean | null;
};

/** Frozen approved windows are authoritative; the worker's current clock is never used. */
export function evaluateAppointmentCalendar(input: {
  authorization: AppointmentAuthorization | null | undefined;
  candidate: CalendarCandidate | null;
  referenceAt: string | null;
  applicable?: boolean;
}): CalendarEvaluation {
  const result = (eligibility: CalendarEvaluation["eligibility"], reason: CalendarReason): CalendarEvaluation =>
    ({ eligibility, reason, windowIndex: null, startsAt: null, pastAtReference: null });
  if (input.applicable === false) return result("not_applicable", "missing_authority");
  if (!input.authorization) return result("unknown", "missing_authority");
  const parsed = appointmentAuthorizationSchema.safeParse(input.authorization);
  if (!parsed.success) return result("unknown", "invalid_authority");
  const candidate = input.candidate;
  if (!candidate?.date) return result("unknown", "missing_date");
  if (!appointmentDateSchema.safeParse(candidate.date).success) return result("unknown", "invalid_date");
  if (!candidate.startTime) return result("unknown", "missing_time");
  if (!appointmentTimeSchema.safeParse(candidate.startTime).success) return result("unknown", "invalid_time");
  if (candidate.timeZone !== parsed.data.timeZone) return result("unknown", "zone_conflict");
  const windowIndex = parsed.data.windows.findIndex(window => window.date === candidate.date &&
    window.startTime <= candidate.startTime! && candidate.startTime! <= window.endTime);
  if (windowIndex < 0) return result("outside", "outside_window");
  const instants = matchingInstants({ date: candidate.date, startTime: candidate.startTime, timeZone: candidate.timeZone });
  if (!instants) return result("unknown", "invalid_authority");
  if (!instants.length) return result("unknown", "nonexistent_local_time");
  if (instants.length !== 1) return result("unknown", "ambiguous_local_time");
  const reference = input.referenceAt === null ? NaN : Date.parse(input.referenceAt);
  return { eligibility: "within", reason: "exact_window", windowIndex, startsAt: new Date(instants[0]!).toISOString(),
    pastAtReference: Number.isFinite(reference) ? instants[0]! <= reference : null };
}

/** Enumerate UTC minutes: covers IANA offsets, skipped dates and both sides of DST folds. */
function matchingInstants(candidate: { date: string; startTime: string; timeZone: string }): number[] | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB-u-ca-iso8601-nu-latn", {
      timeZone: candidate.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    });
    const middle = Date.parse(`${candidate.date}T${candidate.startTime}:00.000Z`);
    const expected = `${candidate.date}T${candidate.startTime}:00`;
    const matches: number[] = [];
    for (let offset = -1440; offset <= 1440; offset++) {
      const instant = middle + offset * 60_000;
      const parts = formatter.formatToParts(instant);
      const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
      if (`${part("year")?.padStart(4, "0")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}` === expected) matches.push(instant);
      if (matches.length === 2) break;
    }
    return matches;
  } catch { return null; }
}
