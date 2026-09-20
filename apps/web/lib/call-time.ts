import { formatLocale, type CallBrief } from "@callassist/contracts";
import { isTerminalCallStatus } from "./call-status";
import type { UiLocale } from "./i18n/messages";

/** Connected call time, including consent; never count ringing or plan preparation. */
export function formatCallDuration(brief: Pick<CallBrief, "status" | "lifecycle">): string | null {
  const { connectedAt, endedAt } = brief.lifecycle ?? {};
  if (!isTerminalCallStatus(brief.status) || !connectedAt || !endedAt) return null;
  const elapsed = Date.parse(endedAt) - Date.parse(connectedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return minutes < 60
    ? `${minutes}:${remainder}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${remainder}`;
}

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
    relative: new Intl.RelativeTimeFormat(formatLocale(locale), { numeric: "auto" }).format(value, unit),
    exact: new Intl.DateTimeFormat(formatLocale(locale), { dateStyle: "medium", timeStyle: "short" }).format(date)
  };
}
