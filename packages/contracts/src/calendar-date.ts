import { appointmentDateSchema } from "./appointment";

/** A local Gregorian calendar date, NOT an instant to convert to an appointment zone. */
export function calendarDateDetails(date: string, locale: string, style: "long" | "numeric" = "long") {
  const canonical = appointmentDateSchema.parse(date);
  // UTC is a stable date ordinal for formatting; the approved zone still governs
  // appointment clock time, DST validation and relative-date interpretation.
  const ordinal = new Date(`${canonical}T00:00:00.000Z`);
  const options = { timeZone: "UTC", calendar: "gregory" } as const;
  return {
    date: canonical,
    weekdayIso: ordinal.getUTCDay() || 7,
    weekdayLabel: new Intl.DateTimeFormat(locale, { ...options, weekday: "long" }).format(ordinal),
    dateLabel: new Intl.DateTimeFormat(locale, { ...options, weekday: "long", year: "numeric",
      month: style === "long" ? "long" : "2-digit", day: style === "long" ? "numeric" : "2-digit" }).format(ordinal)
  };
}
