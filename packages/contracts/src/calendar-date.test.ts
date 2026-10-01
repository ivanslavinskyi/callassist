import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarDateDetails } from "./calendar-date";
import { formatLocale, uiLocales } from "./ui-locales";

afterEach(() => vi.unstubAllEnvs());

describe("local calendar date annotations", () => {
  it.each([
    ["2026-10-01", 4], ["2026-10-03", 6], ["2026-10-04", 7],
    ["2026-10-05", 1], ["2026-10-06", 2], ["2026-10-07", 3],
    ["2024-02-29", 4], ["2026-03-29", 7], ["2026-10-25", 7],
    ["2026-12-31", 4], ["2027-01-01", 5]
  ])("computes the Gregorian ISO weekday for %s", (date, weekday) => {
    expect(calendarDateDetails(date as string, "en-GB")).toMatchObject({ date, weekdayIso: weekday });
  });
  it.each(["2026-02-29", "2026-02-30", "2026-13-01", "01.10.2026", "2026-10-01T00:00:00Z"])(
    "rejects invalid or noncanonical calendar input %s", date => {
      expect(() => calendarDateDetails(date, "en-GB")).toThrow();
    });
  it.each([
    ["de-CH", "Donnerstag"], ["de-DE", "Donnerstag"], ["fr-CH", "jeudi"],
    ["it-CH", "giovedì"], ["en-GB", "Thursday"], ["en-US", "Thursday"], ["ru-RU", "четверг"]
  ])("localizes the same date in call locale %s", (locale, weekday) => {
    const details = calendarDateDetails("2026-10-01", locale);
    expect(details.weekdayLabel).toBe(weekday);
    expect(details.dateLabel).toContain(weekday);
    expect(details.dateLabel).toContain("2026");
  });
  it.each(uiLocales)("supports the %s interface date format", locale => {
    const expected = { de: "Donnerstag", fr: "jeudi", it: "giovedì", rm: "gievgia", en: "Thursday", ru: "четверг", uk: "четвер" };
    expect(calendarDateDetails("2026-10-01", formatLocale(locale), "numeric").weekdayLabel).toBe(expected[locale]);
  });
  it.each(["Pacific/Honolulu", "Pacific/Kiritimati", "Europe/Zurich", "UTC"])(
    "never shifts the date when the host is in %s", timeZone => {
      vi.stubEnv("TZ", timeZone);
      expect(calendarDateDetails("2026-10-01", "de-CH", "numeric")).toEqual({
        date: "2026-10-01", weekdayIso: 4, weekdayLabel: "Donnerstag", dateLabel: "Donnerstag, 01.10.2026"
      });
    });
});
