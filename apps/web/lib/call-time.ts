import type { UiLocale } from "./i18n/messages";

export function formatCallTime(createdAt: string, locale: UiLocale, now = new Date()) {
  const date = new Date(createdAt);
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const absoluteSeconds = Math.abs(seconds);
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    absoluteSeconds < 60 ? [seconds, "second"]
      : absoluteSeconds < 3600 ? [Math.round(seconds / 60), "minute"]
        : absoluteSeconds < 86400 ? [Math.round(seconds / 3600), "hour"]
          : [Math.round(seconds / 86400), "day"];
  return {
    relative: new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(value, unit),
    exact: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date)
  };
}
